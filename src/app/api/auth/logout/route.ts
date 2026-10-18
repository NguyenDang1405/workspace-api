import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { hashToken } from '@/lib/auth';
import { ApiResponse } from '@/types';

export async function POST(request: NextRequest) {
  try {
    const rawRefreshToken = request.cookies.get('refresh_token')?.value;

    if (rawRefreshToken) {
      const tokenHash = hashToken(rawRefreshToken);
      await prisma.userToken.updateMany({
        where: {
          refreshTokenHash: tokenHash,
          revokedAt: null,
        },
        data: {
          revokedAt: new Date(),
          revokeReason: 'USER_LOGOUT',
        },
      });
    }

    const responseBody: ApiResponse = {
      success: true,
      message: 'Logged out successfully',
    };

    const response = NextResponse.json(responseBody, { status: 200 });

    // Clear cookies
    response.cookies.delete('refresh_token');
    response.cookies.delete('access_token');
    response.cookies.delete('token');

    return response;
  } catch (error) {
    console.error('Logout API Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to logout',
        },
      },
      { status: 500 }
    );
  }
}

