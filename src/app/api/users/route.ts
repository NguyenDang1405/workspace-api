import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { generateProfileEmbedding } from '@/lib/openai';
import { UpdateProfileSchema, ApiResponse, Department, Level } from '@/types';

export const dynamic = 'force-dynamic';

/**
 * GET /api/users - List users with pagination and filters
 * Restricted to ADMIN, PM, and LEADER roles.
 */
export async function GET(request: NextRequest) {
  try {
    const userRole = request.headers.get('x-user-role');

    // 1. RBAC check: MEMBER is forbidden from viewing all users
    if (userRole === 'MEMBER') {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: 'Members are not authorized to view the complete talent directory',
          },
        },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.max(1, Math.min(100, parseInt(searchParams.get('limit') || '10', 10)));
    const department = searchParams.get('department') as Department | null;
    const level = searchParams.get('level') as Level | null;

    const whereClause: Record<string, unknown> = {};

    if (department || level) {
      whereClause.talentProfile = {
        ...(department && { department }),
        ...(level && { level }),
      };
    }

    const [total, users] = await Promise.all([
      prisma.user.count({ where: whereClause }),
      prisma.user.findMany({
        where: whereClause,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          email: true,
          fullName: true,
          avatarUrl: true,
          role: true,
          isActive: true,
          createdAt: true,
          updatedAt: true,
          talentProfile: {
            select: {
              department: true,
              level: true,
              skills: true,
              bioSummary: true,
              profileRevision: true,
              embeddingRevision: true,
              isEmbeddingStale: true,
              lastEmbeddedAt: true,
              updatedAt: true,
            },
          },
          teamMemberships: {
            where: { leftAt: null },
            select: {
              team: {
                select: { id: true, name: true },
              },
            },
          },
        },
      }),
    ]);

    const formattedUsers = users.map((u) => ({
      id: u.id,
      email: u.email,
      fullName: u.fullName,
      avatarUrl: u.avatarUrl,
      role: u.role,
      isActive: u.isActive,
      department: u.talentProfile?.department || 'FULLSTACK',
      level: u.talentProfile?.level || 'JUNIOR',
      skills: u.talentProfile?.skills || [],
      bioSummary: u.talentProfile?.bioSummary || null,
      profileRevision: u.talentProfile?.profileRevision
        ? Number(u.talentProfile.profileRevision)
        : 1,
      embeddingRevision: u.talentProfile?.embeddingRevision
        ? Number(u.talentProfile.embeddingRevision)
        : 0,
      isEmbeddingStale: u.talentProfile?.isEmbeddingStale ?? false,
      lastEmbeddedAt: u.talentProfile?.lastEmbeddedAt || null,
      team: u.teamMemberships[0]?.team || null,
      createdAt: u.createdAt,
      updatedAt: u.updatedAt,
    }));

    const responseBody: ApiResponse = {
      success: true,
      data: {
        users: formattedUsers,
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      },
    };

    return NextResponse.json(responseBody, { status: 200 });
  } catch (error) {
    console.error('GET /api/users Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to retrieve users',
        },
      },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/users - Update talent profile and recompute vector embedding
 */
export async function PUT(request: NextRequest) {
  try {
    const currentUserId = request.headers.get('x-user-id');
    const currentUserRole = request.headers.get('x-user-role');

    if (!currentUserId) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'UNAUTHORIZED',
            message: 'User authentication required',
          },
        },
        { status: 401 }
      );
    }

    const body = await request.json();
    const validatedData = UpdateProfileSchema.parse(body);

    const targetUserId = validatedData.targetUserId || currentUserId;

    // RBAC: MEMBER can only update their own profile and cannot change department or level
    if (currentUserRole === 'MEMBER') {
      if (targetUserId !== currentUserId) {
        return NextResponse.json(
          {
            success: false,
            error: {
              code: 'FORBIDDEN',
              message: 'Members can only update their own profile',
            },
          },
          { status: 403 }
        );
      }
      delete validatedData.department;
      delete validatedData.level;
    }

    // Perform update in a transaction with audit actor
    const updatedProfile = await prisma.$transaction(async (tx) => {
      // 1. Audit Trigger Actor context
      await tx.$executeRawUnsafe(`SET LOCAL app.actor_id = '${currentUserId}'`);

      // 2. Update user basic info if provided
      if (validatedData.fullName !== undefined || validatedData.avatarUrl !== undefined) {
        await tx.user.update({
          where: { id: targetUserId },
          data: {
            ...(validatedData.fullName && { fullName: validatedData.fullName }),
            ...(validatedData.avatarUrl !== undefined && { avatarUrl: validatedData.avatarUrl }),
          },
        });
      }

      // 3. Update talent profile fields
      const talentUpdateData: Record<string, unknown> = {};
      if (validatedData.department) talentUpdateData.department = validatedData.department;
      if (validatedData.level) talentUpdateData.level = validatedData.level;
      if (validatedData.skills) talentUpdateData.skills = validatedData.skills;
      if (validatedData.bioSummary !== undefined) talentUpdateData.bioSummary = validatedData.bioSummary;

      if (Object.keys(talentUpdateData).length > 0) {
        await tx.userTalentProfile.upsert({
          where: { userId: targetUserId },
          create: {
            userId: targetUserId,
            department: validatedData.department || 'FULLSTACK',
            level: validatedData.level || 'JUNIOR',
            skills: validatedData.skills || [],
            bioSummary: validatedData.bioSummary || null,
          },
          update: talentUpdateData,
        });
      }

      // 4. Fetch the fresh profileRevision and data for embedding
      const currentProfile = await tx.userTalentProfile.findUnique({
        where: { userId: targetUserId },
      });

      if (!currentProfile) {
        throw new Error('Talent profile not found');
      }

      const observedRevision = currentProfile.profileRevision;

      // 5. Generate embedding
      const vector = await generateProfileEmbedding({
        department: currentProfile.department,
        level: currentProfile.level,
        skills: currentProfile.skills,
        bioSummary: currentProfile.bioSummary,
      });

      // 6. Vector update via raw SQL if embedding succeeded
      if (vector && vector.length > 0) {
        const vectorStr = `[${vector.join(',')}]`;
        await tx.$executeRaw`
          UPDATE user_talent_profiles
          SET skill_embedding = ${vectorStr}::vector,
              embedding_revision = ${observedRevision},
              last_embedded_at = CURRENT_TIMESTAMP
          WHERE user_id = ${targetUserId}::uuid
            AND profile_revision = ${observedRevision}
        `;
      }

      return await tx.userTalentProfile.findUnique({
        where: { userId: targetUserId },
      });
    });

    const responseBody: ApiResponse = {
      success: true,
      data: {
        userId: updatedProfile?.userId,
        department: updatedProfile?.department,
        level: updatedProfile?.level,
        skills: updatedProfile?.skills,
        bioSummary: updatedProfile?.bioSummary,
        profileRevision: updatedProfile?.profileRevision
          ? Number(updatedProfile.profileRevision)
          : 1,
        embeddingRevision: updatedProfile?.embeddingRevision
          ? Number(updatedProfile.embeddingRevision)
          : 0,
        isEmbeddingStale: updatedProfile?.isEmbeddingStale ?? false,
        lastEmbeddedAt: updatedProfile?.lastEmbeddedAt,
      },
      message: 'Talent profile updated successfully',
    };

    return NextResponse.json(responseBody, { status: 200 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid update payload',
            details: error.errors,
          },
        },
        { status: 400 }
      );
    }
    console.error('PUT /api/users Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to update talent profile',
        },
      },
      { status: 500 }
    );
  }
}
