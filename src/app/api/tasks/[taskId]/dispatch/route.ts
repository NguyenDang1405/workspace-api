import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import {
  scoreCandidatesForTask,
  generateAdaptiveChecklist,
} from '@/services/dispatch-scoring.service';
import {
  DispatchTaskSchema,
  DispatchTaskResponseData,
} from '@/types/dispatch.types';
import { ApiResponse } from '@/types';

export const dynamic = 'force-dynamic';

interface RouteParams {
  params: {
    taskId: string;
  };
}

/**
 * POST /api/tasks/[taskId]/dispatch
 *
 * Dispatches a scheduled task to an assigned developer using AI Multi-Objective Scoring
 * and generates level-tailored adaptive guidance checklist.
 *
 * Security & RBAC:
 * - Requires Bearer token verified by middleware.
 * - Allowed roles: ADMIN, PM, LEADER.
 * - MEMBER is strictly forbidden (HTTP 403).
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { taskId } = params;
    const currentUserId = request.headers.get('x-user-id');
    const currentUserRole = request.headers.get('x-user-role');

    // 1. Authentication check
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

    // 2. RBAC check: MEMBER is forbidden from dispatching tasks
    if (currentUserRole === 'MEMBER') {
      return NextResponse.json<ApiResponse>(
        {
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: 'Members are not authorized to dispatch project tasks',
          },
        },
        { status: 403 }
      );
    }

    // 3. Task ID Validation
    if (!taskId || typeof taskId !== 'string' || taskId.trim().length === 0) {
      return NextResponse.json<ApiResponse>(
        {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Task ID is missing or invalid',
          },
        },
        { status: 400 }
      );
    }

    // 4. Request Body Validation
    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return NextResponse.json<ApiResponse>(
        {
          success: false,
          error: {
            code: 'INVALID_JSON',
            message: 'Malformed or missing JSON request body',
          },
        },
        { status: 400 }
      );
    }

    const validationResult = DispatchTaskSchema.safeParse(rawBody);
    if (!validationResult.success) {
      return NextResponse.json<ApiResponse>(
        {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid dispatch payload',
            details: validationResult.error.flatten(),
          },
        },
        { status: 400 }
      );
    }

    const { assignedUserId, overrideReason } = validationResult.data;

    // 5. Verify Candidate User exists and is active
    const candidateUser = await prisma.user.findUnique({
      where: { id: assignedUserId },
      select: {
        id: true,
        fullName: true,
        email: true,
        isActive: true,
        talentProfile: {
          select: {
            department: true,
            level: true,
          },
        },
      },
    });

    if (!candidateUser) {
      return NextResponse.json<ApiResponse>(
        {
          success: false,
          error: {
            code: 'USER_NOT_FOUND',
            message: 'Assigned user does not exist',
          },
        },
        { status: 404 }
      );
    }

    if (!candidateUser.isActive) {
      return NextResponse.json<ApiResponse>(
        {
          success: false,
          error: {
            code: 'USER_INACTIVE',
            message: 'Cannot dispatch task to an inactive user',
          },
        },
        { status: 400 }
      );
    }

    // 6. Score Candidates & Evaluate Multi-Objective Heuristics
    const { task, rankedCandidates } = await scoreCandidatesForTask(taskId);

    // 7. Determine Human Override Flag
    const topRecommendedUser = rankedCandidates[0];
    const isHumanOverride = Boolean(
      topRecommendedUser && topRecommendedUser.userId !== assignedUserId
    );

    const chosenCandidateScored = rankedCandidates.find(
      (c) => c.userId === assignedUserId
    );
    const candidateLevel = candidateUser.talentProfile?.level || 'JUNIOR';

    // 8. Generate Adaptive Guidance Checklist Tailored to Developer Seniority
    const adaptiveChecklist = await generateAdaptiveChecklist(
      task.title,
      task.description,
      candidateLevel
    );

    // 9. Atomic Transaction: Persist Task Assignment, History, and Audit Log
    const top3Recommended = rankedCandidates.slice(0, 3).map((c) => ({
      userId: c.userId,
      fullName: c.fullName,
      compositeScore: c.compositeScore,
      rawRrfScore: c.rawRrfScore,
      eloScore: c.eloScore,
      activeWorkload: c.activeWorkload,
    }));

    await prisma.$transaction(async (tx) => {
      // 1. Update Task status and assignment
      await tx.task.update({
        where: { id: taskId },
        data: {
          assignedTo: assignedUserId,
          status: 'TODO',
          checklist: adaptiveChecklist as any,
        },
      });

      // 2. Record Task Status History
      await tx.taskStatusHistory.create({
        data: {
          taskId,
          changedBy: currentUserId,
          fromStatus: 'SCHEDULED',
          toStatus: 'TODO',
        },
      });

      // 3. Record Dispatch History for thesis research and audit
      await tx.dispatchHistory.create({
        data: {
          taskId,
          recommendedCandidates: top3Recommended as any,
          chosenUserId: assignedUserId,
          isHumanOverride,
          overrideReason: overrideReason || null,
        },
      });
    });

    const responseData: DispatchTaskResponseData = {
      taskId,
      taskTitle: task.title,
      assignedUserId,
      assignedUserName: candidateUser.fullName,
      assignedUserLevel: candidateLevel,
      isHumanOverride,
      overrideReason: overrideReason || null,
      compositeScore: chosenCandidateScored ? chosenCandidateScored.compositeScore : null,
      checklist: adaptiveChecklist,
      recommendedCandidates: top3Recommended,
    };

    return NextResponse.json<ApiResponse<DispatchTaskResponseData>>(
      {
        success: true,
        data: responseData,
        message: 'Task successfully dispatched with adaptive checklist',
      },
      { status: 200 }
    );
  } catch (error: unknown) {
    if (error instanceof Error) {
      if (error.message === 'TASK_NOT_FOUND') {
        return NextResponse.json<ApiResponse>(
          {
            success: false,
            error: {
              code: 'TASK_NOT_FOUND',
              message: 'Task does not exist',
            },
          },
          { status: 404 }
        );
      }

      if (error.message === 'TASK_NOT_IN_SCHEDULED_STATE') {
        return NextResponse.json<ApiResponse>(
          {
            success: false,
            error: {
              code: 'TASK_NOT_IN_SCHEDULED_STATE',
              message: 'Only tasks in SCHEDULED status can be dispatched',
            },
          },
          { status: 400 }
        );
      }
    }

    if (error instanceof z.ZodError) {
      return NextResponse.json<ApiResponse>(
        {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Validation failed',
            details: error.errors,
          },
        },
        { status: 400 }
      );
    }

    console.error('POST /api/tasks/[taskId]/dispatch Error:', error);
    return NextResponse.json<ApiResponse>(
      {
        success: false,
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Internal server error',
        },
      },
      { status: 500 }
    );
  }
}

