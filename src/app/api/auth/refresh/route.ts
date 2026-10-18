import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  createAccessToken,
  generateRefreshToken,
  hashToken,
} from '@/lib/auth';
import { ApiResponse } from '@/types';

export async function POST(request: NextRequest) {
  try {
    let rawRefreshToken = request.cookies.get('refresh_token')?.value;

    if (!rawRefreshToken) {
      try {
        const body = await request.json();
        rawRefreshToken = body.refreshToken;
      } catch {
        // No json body
      }
    }

    if (!rawRefreshToken) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'MISSING_REFRESH_TOKEN',
            message: 'Refresh token is required',
          },
        },
        { status: 401 }
      );
    }

    const tokenHash = hashToken(rawRefreshToken);

    const tokenRecord = await prisma.userToken.findUnique({
      where: { refreshTokenHash: tokenHash },
      include: { user: true },
    });

    if (!tokenRecord) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'INVALID_REFRESH_TOKEN',
            message: 'Refresh token not found or invalid',
          },
        },
        { status: 401 }
      );
    }

    // 1. Token Reuse Detection
    if (tokenRecord.revokedAt) {
      // Security breach: Revoke all tokens in this family immediately
      await prisma.userToken.updateMany({
        where: { tokenFamilyId: tokenRecord.tokenFamilyId },
        data: {
          revokedAt: new Date(),
          revokeReason: 'REUSE_DETECTED',
        },
      });

      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'REUSE_DETECTED',
            message: 'Compromised token detected. All associated sessions have been revoked.',
          },
        },
        { status: 401 }
      );
    }

    // 2. Expiration check
    if (tokenRecord.expiresAt < new Date()) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'TOKEN_EXPIRED',
            message: 'Refresh token has expired',
          },
        },
        { status: 401 }
      );
    }

    // 3. User active check
    if (!tokenRecord.user.isActive) {
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

    // 4. Token Rotation
    const newRawRefreshToken = generateRefreshToken();
    const newRefreshTokenHash = hashToken(newRawRefreshToken);
    const newExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    const newAccessToken = await createAccessToken({
      userId: tokenRecord.user.id,
      email: tokenRecord.user.email,
      role: tokenRecord.user.role,
      authVersion: tokenRecord.user.authVersion,
      fullName: tokenRecord.user.fullName,
    });

    await prisma.$transaction(async (tx) => {
      // Revoke current token
      await tx.userToken.update({
        where: { id: tokenRecord.id },
        data: {
          revokedAt: new Date(),
          revokeReason: 'ROTATED',
        },
      });

      // Issue new token in same family
      await tx.userToken.create({
        data: {
          tokenFamilyId: tokenRecord.tokenFamilyId,
          userId: tokenRecord.userId,
          refreshTokenHash: newRefreshTokenHash,
          expiresAt: newExpiresAt,
          deviceInfo: request.headers.get('user-agent')?.slice(0, 255) || 'Unknown Device',
          ipAddress: request.headers.get('x-forwarded-for')?.slice(0, 45) || '127.0.0.1',
          replacedByTokenId: null,
        },
      });
    });

    const responseBody: ApiResponse = {
      success: true,
      data: {
        accessToken: newAccessToken,
      },
      message: 'Token rotated successfully',
    };

    const response = NextResponse.json(responseBody, { status: 200 });

    response.cookies.set('refresh_token', newRawRefreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/api/auth',
      maxAge: 30 * 24 * 60 * 60,
    });

    response.cookies.set('access_token', newAccessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60,
    });

    return response;
  } catch (error) {
    console.error('Refresh Token API Error:', error);
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

