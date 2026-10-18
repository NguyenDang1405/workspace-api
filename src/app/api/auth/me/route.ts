import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiResponse } from '@/types';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const userId = request.headers.get('x-user-id');
    if (!userId) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'UNAUTHORIZED',
            message: 'Unauthorized request',
          },
        },
        { status: 401 }
      );
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        fullName: true,
        avatarUrl: true,
        role: true,
        isActive: true,
        createdAt: true,
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
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
    });

    if (!user) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'USER_NOT_FOUND',
            message: 'User does not exist',
          },
        },
        { status: 404 }
      );
    }

    const responseBody: ApiResponse = {
      success: true,
      data: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        avatarUrl: user.avatarUrl,
        role: user.role,
        isActive: user.isActive,
        department: user.talentProfile?.department || 'FULLSTACK',
        level: user.talentProfile?.level || 'JUNIOR',
        skills: user.talentProfile?.skills || [],
        bioSummary: user.talentProfile?.bioSummary || null,
        profileRevision: user.talentProfile?.profileRevision
          ? Number(user.talentProfile.profileRevision)
          : 1,
        embeddingRevision: user.talentProfile?.embeddingRevision
          ? Number(user.talentProfile.embeddingRevision)
          : 0,
        isEmbeddingStale: user.talentProfile?.isEmbeddingStale ?? false,
        team: user.teamMemberships[0]?.team || null,
        createdAt: user.createdAt,
      },
    };

    return NextResponse.json(responseBody, { status: 200 });
  } catch (error) {
    console.error('GET /api/auth/me Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Internal server error',
        },
      },
      { status: 500 }
    );
  }
}

