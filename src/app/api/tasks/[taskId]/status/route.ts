import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { validateFSMTransition } from '@/services/kanban-flow.service';
import { UpdateTaskStatusSchema } from '@/types/kanban.types';
import { ApiResponse } from '@/types';

export const dynamic = 'force-dynamic';

interface RouteParams {
  params: {
    taskId: string;
  };
}

/**
 * PATCH /api/tasks/[taskId]/status
 *
 * Updates a task's status conforming strictly to Finite State Machine (FSM) rules,
 * enforces Review Guard (only PM/LEADER/ADMIN can approve to DONE),
 * updates flow timestamps (started_at, in_review_at, completed_at, actual_hours),
 * and logs transition duration into task_status_history within an atomic transaction.
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
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

    // 2. Validate Task ID
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

    // 3. Parse and Validate Request Body
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

    const validationResult = UpdateTaskStatusSchema.safeParse(rawBody);
    if (!validationResult.success) {
      return NextResponse.json<ApiResponse>(
        {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid task status update payload',
            details: validationResult.error.flatten(),
          },
        },
        { status: 400 }
      );
    }

    const { toStatus, blockReason, checklistUpdates } = validationResult.data;

    // 4. Retrieve Current Task
    const currentTask = await prisma.task.findUnique({
      where: { id: taskId },
    });

    if (!currentTask) {
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

    // 5. Strict Finite State Machine (FSM) Transition Validation
    const isTransitionValid = validateFSMTransition(currentTask.status, toStatus);
    if (!isTransitionValid) {
      return NextResponse.json<ApiResponse>(
        {
          success: false,
          error: {
            code: 'INVALID_STATE_TRANSITION',
            message: `Invalid state transition from ${currentTask.status} to ${toStatus}`,
          },
        },
        { status: 400 }
      );
    }

    // 6. Review Guard: Only ADMIN, PM, and LEADER can approve transition to DONE
    if (toStatus === 'DONE' && currentUserRole === 'MEMBER') {
      return NextResponse.json<ApiResponse>(
        {
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: 'Members are not authorized to mark tasks as DONE. Only Leader/PM/Admin can approve review.',
          },
        },
        { status: 403 }
      );
    }

    const now = new Date();

    // 7. Execute Atomic Transaction: Timestamps, Duration, Status History & Checklist
    const updatedTask = await prisma.$transaction(async (tx) => {
      const isStatusChanged = toStatus !== currentTask.status;

      // Calculate duration spent in the previous status
      let durationInPreviousStatusHours: number | null = null;
      if (isStatusChanged) {
        const latestHistory = await tx.taskStatusHistory.findFirst({
          where: { taskId },
          orderBy: { createdAt: 'desc' },
        });

        const baseTime = latestHistory?.createdAt || currentTask.updatedAt || currentTask.createdAt;
        durationInPreviousStatusHours = Number(
          Math.max(0.01, (now.getTime() - new Date(baseTime).getTime()) / (1000 * 60 * 60)).toFixed(2)
        );
      }

      // Build task updates payload
      const taskUpdateData: Record<string, any> = {
        status: toStatus,
      };

      if (toStatus === 'IN_PROGRESS' && !currentTask.startedAt) {
        taskUpdateData.startedAt = now;
      }

      if (toStatus === 'REVIEW') {
        taskUpdateData.inReviewAt = now;
      }

      if (toStatus === 'DONE') {
        taskUpdateData.completedAt = now;
        const startRef = currentTask.startedAt || currentTask.createdAt;
        const computedActual = Number(
          Math.max(0.01, (now.getTime() - startRef.getTime()) / (1000 * 60 * 60)).toFixed(2)
        );
        taskUpdateData.actualHours = new Prisma.Decimal(computedActual);
      }

      if (blockReason !== undefined) {
        taskUpdateData.blockReason = blockReason;
        taskUpdateData.isBlocked = Boolean(blockReason && blockReason.trim().length > 0);
      }

      // Handle checklist updates if provided
      if (checklistUpdates && Array.isArray(checklistUpdates)) {
        let currentChecklist: any[] = Array.isArray(currentTask.checklist)
          ? [...(currentTask.checklist as any[])]
          : [];

        checklistUpdates.forEach((upd) => {
          const item = currentChecklist.find((it: any) => it.id === upd.id);
          if (item) {
            item.isCompleted = upd.isCompleted;
            item.done = upd.isCompleted;
          }
        });

        taskUpdateData.checklist = currentChecklist;
      }

      // 1. Update Task
      const result = await tx.task.update({
        where: { id: taskId },
        data: taskUpdateData,
        include: {
          assignee: {
            select: {
              id: true,
              fullName: true,
              avatarUrl: true,
            },
          },
        },
      });

      // 2. Record Status History on transition
      if (isStatusChanged && durationInPreviousStatusHours !== null) {
        await tx.taskStatusHistory.create({
          data: {
            taskId,
            changedBy: currentUserId,
            fromStatus: currentTask.status,
            toStatus,
            durationInPreviousStatusHours: new Prisma.Decimal(durationInPreviousStatusHours),
          },
        });
      }

      return result;
    });

    return NextResponse.json<ApiResponse>(
      {
        success: true,
        data: updatedTask,
        message: `Task successfully transitioned to ${toStatus}`,
      },
      { status: 200 }
    );
  } catch (error: unknown) {
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

    console.error('PATCH /api/tasks/[taskId]/status Error:', error);
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

