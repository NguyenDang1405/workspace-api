import { NextResponse, type NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { TaskReviewActionSchema, TaskReviewResponseData } from '@/types/elo.types';
import { processTaskEloCalibration } from '@/services/elo-calibration.service';
import { ApiResponse } from '@/types';

export const dynamic = 'force-dynamic';

interface RouteParams {
  params: {
    taskId: string;
  };
}

/**
 * POST /api/tasks/[taskId]/review
 *
 * Leader/PM/Admin reviews a task in REVIEW status:
 * - action = 'APPROVE': Transitions task to DONE, records actual_hours, logs REVIEW -> DONE,
 *                       and awards skill Elo rating points.
 * - action = 'REJECT':  Transitions task back to IN_PROGRESS, logs REVIEW -> IN_PROGRESS,
 *                       and penalizes skill Elo rating points.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { taskId } = params;
    const currentUserId = request.headers.get('x-user-id');
    const currentUserRole = request.headers.get('x-user-role');

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

    // 2. RBAC Guard: Only ADMIN, PM, or LEADER can review tasks
    if (currentUserRole === 'MEMBER') {
      return NextResponse.json<ApiResponse>(
        {
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: 'Members are not authorized to review or approve tasks',
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

    const validationResult = TaskReviewActionSchema.safeParse(rawBody);
    if (!validationResult.success) {
      return NextResponse.json<ApiResponse>(
        {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid review payload',
            details: validationResult.error.flatten(),
          },
        },
        { status: 400 }
      );
    }

    const { action, feedback, primarySkill } = validationResult.data;

    // 5. Query Task and Validate Status
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: {
        id: true,
        title: true,
        status: true,
        assignedTo: true,
        requiredLevel: true,
        estimatedHours: true,
        actualHours: true,
        startedAt: true,
        inReviewAt: true,
        isCriticalPath: true,
      },
    });

    if (!task) {
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

    if (!task.assignedTo) {
      return NextResponse.json<ApiResponse>(
        {
          success: false,
          error: {
            code: 'TASK_HAS_NO_ASSIGNEE',
            message: 'Cannot review a task without an assigned developer',
          },
        },
        { status: 400 }
      );
    }

    if (task.status !== 'REVIEW') {
      return NextResponse.json<ApiResponse>(
        {
          success: false,
          error: {
            code: 'TASK_NOT_IN_REVIEW_STATE',
            message: `Task is currently in ${task.status} status and cannot be reviewed. Task must be in REVIEW state.`,
          },
        },
        { status: 400 }
      );
    }

    const now = new Date();

    // 6. Calculate Duration Spent in REVIEW Status
    let reviewDurationHours: number | null = null;
    if (task.inReviewAt) {
      const diffMs = now.getTime() - new Date(task.inReviewAt).getTime();
      reviewDurationHours = Math.max(0.01, Number((diffMs / (1000 * 60 * 60)).toFixed(2)));
    }

    // 7. Atomic Transaction: Status Transition, Task History, and Elo Calibration
    const { newStatus, eloResult } = await prisma.$transaction(async (tx) => {
      let nextStatus: 'DONE' | 'IN_PROGRESS';

      if (action === 'APPROVE') {
        nextStatus = 'DONE';

        // Calculate actual hours if not already set
        let actualHours = task.actualHours ? Number(task.actualHours) : null;
        if (!actualHours && task.startedAt) {
          const diffMs = now.getTime() - new Date(task.startedAt).getTime();
          actualHours = Math.max(0.1, Number((diffMs / (1000 * 60 * 60)).toFixed(2)));
        } else if (!actualHours) {
          actualHours = Number(task.estimatedHours) || 4.0;
        }

        // Update task to DONE
        await tx.task.update({
          where: { id: taskId },
          data: {
            status: 'DONE',
            completedAt: now,
            actualHours: new Prisma.Decimal(actualHours),
          },
        });

        // Record status history
        await tx.taskStatusHistory.create({
          data: {
            taskId,
            changedBy: currentUserId,
            fromStatus: 'REVIEW',
            toStatus: 'DONE',
            durationInPreviousStatusHours: reviewDurationHours
              ? new Prisma.Decimal(reviewDurationHours)
              : null,
          },
        });
      } else {
        nextStatus = 'IN_PROGRESS';

        // Revert task back to IN_PROGRESS
        await tx.task.update({
          where: { id: taskId },
          data: {
            status: 'IN_PROGRESS',
            inReviewAt: null,
            blockReason: feedback || null,
          },
        });

        // Record status history
        await tx.taskStatusHistory.create({
          data: {
            taskId,
            changedBy: currentUserId,
            fromStatus: 'REVIEW',
            toStatus: 'IN_PROGRESS',
            durationInPreviousStatusHours: reviewDurationHours
              ? new Prisma.Decimal(reviewDurationHours)
              : null,
          },
        });
      }

      // Execute Elo Calibration within the same transaction
      const elo = await processTaskEloCalibration(taskId, action, primarySkill, tx);

      return {
        newStatus: nextStatus,
        eloResult: elo,
      };
    });

    const responseData: TaskReviewResponseData = {
      taskId,
      newStatus,
      action,
      feedback: feedback || null,
      elo: eloResult,
    };

    return NextResponse.json<ApiResponse<TaskReviewResponseData>>(
      {
        success: true,
        data: responseData,
        message: `Task successfully ${action === 'APPROVE' ? 'approved' : 'rejected'} and skill Elo calibrated`,
      },
      { status: 200 }
    );
  } catch (error: unknown) {
    console.error('POST /api/tasks/[taskId]/review Error:', error);
    return NextResponse.json<ApiResponse>(
      {
        success: false,
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to process task review',
        },
      },
      { status: 500 }
    );
  }
}

