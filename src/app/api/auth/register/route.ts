import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { hashPassword, createAccessToken } from '@/lib/auth';
import { RegisterSchema, ApiResponse } from '@/types';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const validatedData = RegisterSchema.parse(body);

    const existingUser = await prisma.user.findUnique({
      where: { email: validatedData.email },
    });

    if (existingUser) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'EMAIL_ALREADY_EXISTS',
            message: 'Email already registered',
          },
        },
        { status: 409 }
      );
    }

    const passwordHash = await hashPassword(validatedData.password);

    const user = await prisma.$transaction(async (tx) => {
      const createdUser = await tx.user.create({
        data: {
          email: validatedData.email,
          passwordHash,
          fullName: validatedData.fullName,
          avatarUrl: validatedData.avatarUrl || null,
          role: validatedData.role,
          accountType: validatedData.accountType,
        },
      });

      await tx.userTalentProfile.create({
        data: {
          userId: createdUser.id,
          department: validatedData.department,
          level: validatedData.level,
          skills: validatedData.skills || [],
          bioSummary: validatedData.bioSummary || null,
        },
      });

      // MOD-13: Zero-friction Onboarding for INDIVIDUAL accounts
      if (validatedData.accountType === 'INDIVIDUAL') {
        const slug = `personal-${createdUser.id.slice(0, 8)}`;
        const workspace = await tx.workspace.create({
          data: {
            name: `Không gian của ${createdUser.fullName}`,
            slug,
            ownerId: createdUser.id,
            members: {
              create: {
                userId: createdUser.id,
                role: 'OWNER',
              },
            },
          },
        });

        await tx.project.create({
          data: {
            name: 'Kế hoạch Học tập & Mục tiêu Cá nhân',
            description: 'Dự án cá nhân đầu tiên được khởi tạo tự động',
            ownerId: createdUser.id,
            workspaceId: workspace.id,
            isPersonalMode: true,
            complexity: 'EASY',
            startDate: new Date(),
            targetEndDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          },
        });
      }

      return createdUser;
    });

    const accessToken = await createAccessToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      authVersion: user.authVersion,
      fullName: user.fullName,
      accountType: user.accountType,
    });

    const responseBody: ApiResponse = {
      success: true,
      data: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        avatarUrl: user.avatarUrl,
        role: user.role,
        accountType: user.accountType,
        accessToken,
      },
      message: 'User registered successfully',
    };

    const response = NextResponse.json(responseBody, { status: 201 });

    response.cookies.set('access_token', accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60,
      path: '/',
    });

    return response;
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid input data',
            details: error.errors,
          },
        },
        { status: 400 }
      );
    }
    console.error('Register API Error:', error);
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
