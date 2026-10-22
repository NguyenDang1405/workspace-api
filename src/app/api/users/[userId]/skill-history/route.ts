import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  SkillHistoryItemDto,
  UserSkillHistoryResponseData,
} from '@/types/elo.types';
import { ApiResponse } from '@/types';

export const dynamic = 'force-dynamic';

interface RouteParams {
  params: {
    userId: string;
  };
}

/**
 * GET /api/users/[userId]/skill-history
 *
 * Retrieves the time-series history of a developer's skill Elo ratings.
 * Sorted chronologically ascending (created_at ASC) for timeline chart plotting.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { userId } = params;
    const currentUserId = request.headers.get('x-user-id');

    // 1. Authentication Check
    if (!currentUserId) {
      return NextResponse.json<ApiResponse>(
        {
          success: false,
          error: {
            code: 'UNAUTHORIZED',
            message: 'Authentication token is required',
          },
        },
        { status: 401 }
      );
    }

    // 2. Validate User ID
    if (!userId || typeof userId !== 'string' || userId.trim().length === 0) {
      return NextResponse.json<ApiResponse>(
        {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'User ID is missing or invalid',
          },
        },
        { status: 400 }
      );
    }

    // 3. Verify Target User Exists
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, fullName: true },
    });

    if (!user) {
      return NextResponse.json<ApiResponse>(
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

    // 4. Parse Query Parameters
    const { searchParams } = new URL(request.url);
    const skillName = searchParams.get('skillName') || undefined;
    const limitParam = parseInt(searchParams.get('limit') || '20', 10);
    const limit = Math.max(1, Math.min(100, isNaN(limitParam) ? 20 : limitParam));

    // 5. Query Time-Series Skill Rating Logs
    const logs = await prisma.userSkillRatingLog.findMany({
      where: {
        userId,
        ...(skillName ? { skillName } : {}),
      },
      include: {
        task: {
          select: {
            title: true,
          },
        },
      },
      orderBy: {
        createdAt: 'asc',
      },
      take: limit,
    });

    const history: SkillHistoryItemDto[] = logs.map((log) => ({
      id: log.id,
      skillName: log.skillName,
      taskId: log.taskId,
      taskTitle: log.task?.title || null,
      oldRating: Number(log.oldRating),
      newRating: Number(log.newRating),
      delta: Number(log.delta),
      eventType: log.eventType,
      createdAt: log.createdAt.toISOString(),
    }));

    const responseData: UserSkillHistoryResponseData = {
      userId,
      history,
    };

    return NextResponse.json<ApiResponse<UserSkillHistoryResponseData>>(
      {
        success: true,
        data: responseData,
        message: 'Skill history retrieved successfully',
      },
      { status: 200 }
    );
  } catch (error: unknown) {
    console.error('GET /api/users/[userId]/skill-history Error:', error);
    return NextResponse.json<ApiResponse>(
      {
        success: false,
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to retrieve skill history',
        },
      },
      { status: 500 }
    );
  }
}

