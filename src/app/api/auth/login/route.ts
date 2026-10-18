import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import {
  comparePassword,
  createAccessToken,
  generateRefreshToken,
  hashToken,
} from '@/lib/auth';
import { LoginSchema, ApiResponse } from '@/types';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { email, password } = LoginSchema.parse(body);

    const user = await prisma.user.findUnique({
      where: { email },
      include: {
        talentProfile: true,
      },
    });

    if (!user) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'INVALID_CREDENTIALS',
            message: 'Invalid email or password',
          },
        },
        { status: 401 }
      );
    }

    const isPasswordValid = await comparePassword(password, user.passwordHash);
    if (!isPasswordValid) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'INVALID_CREDENTIALS',
            message: 'Invalid email or password',
          },
        },
        { status: 401 }
      );
    }

    if (!user.isActive) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'USER_INACTIVE',
            message: 'User account has been deactivated',
          },
        },
        { status: 403 }
      );
    }

    // 1. Generate Access Token (1h)
    const accessToken = await createAccessToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      authVersion: user.authVersion,
      fullName: user.fullName,
    });

    // 2. Generate Refresh Token and persist hashed version
    const rawRefreshToken = generateRefreshToken();
    const refreshTokenHash = hashToken(rawRefreshToken);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

    await prisma.userToken.create({
      data: {
        userId: user.id,
        refreshTokenHash,
        expiresAt,
        deviceInfo: request.headers.get('user-agent')?.slice(0, 255) || 'Unknown Device',
        ipAddress: request.headers.get('x-forwarded-for')?.slice(0, 45) || '127.0.0.1',
      },
    });

    const responseBody: ApiResponse = {
      success: true,
      data: {
        accessToken,
        user: {
          id: user.id,
          email: user.email,
          fullName: user.fullName,
          role: user.role,
          avatarUrl: user.avatarUrl,
          talentProfile: user.talentProfile
            ? {
                department: user.talentProfile.department,
                level: user.talentProfile.level,
                skills: user.talentProfile.skills,
                bioSummary: user.talentProfile.bioSummary,
              }
            : null,
        },
      },
      message: 'Login successful',
    };

    const response = NextResponse.json(responseBody, { status: 200 });

    // Set refresh token cookie (restricted to /api/auth)
    response.cookies.set('refresh_token', rawRefreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/api/auth',
      maxAge: 30 * 24 * 60 * 60,
    });

    // Also set access_token cookie for browser convenience
    response.cookies.set('access_token', accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60,
    });

    return response;
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid input',
            details: error.errors,
          },
        },
        { status: 400 }
      );
    }
    console.error('Login API Error:', error);
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
