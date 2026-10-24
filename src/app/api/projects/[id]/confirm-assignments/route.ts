import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { confirmAutoDispatchAssignments } from '@/services/auto-dispatch-scheduler.service';
import { ApiResponse } from '@/types';
import {
  ConfirmAssignmentsSchema,
  ConfirmAssignmentsResponseData,
} from '@/types/auto-dispatch.types';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: {
    id: string;
  };
}

/**
 * POST /api/projects/:id/confirm-assignments
 *
 * Confirms & commits task assignments and CPM calendar dates to the database.
 * Supports manual override modifications from Project Leaders (Human-in-the-Loop)
 * and bypasses approval for Individual/Personal mode projects.
 */
export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const projectId = params.id;
    const userId = request.headers.get('x-user-id');
    const userRole = request.headers.get('x-user-role');

    // 1. Authentication Check
    if (!userId) {
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

    // 2. Project ID Validation & Retrieval
    if (!projectId || typeof projectId !== 'string' || projectId.trim().length === 0) {
      return NextResponse.json<ApiResponse>(
        {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Project ID is missing or invalid',
          },
        },
        { status: 400 }
      );
    }

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, ownerId: true, isPersonalMode: true },
    });

    if (!project) {
      return NextResponse.json<ApiResponse>(
        {
          success: false,
          error: {
            code: 'PROJECT_NOT_FOUND',
            message: 'Project does not exist',
          },
        },
        { status: 404 }
      );
    }

    // 3. RBAC Check: Only LEADER, PM, ADMIN or Personal Project Owner can confirm assignments
    const isPersonalOwner = project.isPersonalMode && project.ownerId === userId;
    if (userRole === 'MEMBER' && !isPersonalOwner) {
      return NextResponse.json<ApiResponse>(
        {
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: 'Members are not authorized to confirm task assignments',
          },
        },
        { status: 403 }
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

    const validationResult = ConfirmAssignmentsSchema.safeParse(rawBody);
    if (!validationResult.success) {
      return NextResponse.json<ApiResponse>(
        {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid assignment confirmation data',
            details: validationResult.error.flatten(),
          },
        },
        { status: 400 }
      );
    }

    // 5. Commit Assignments within Database Transaction
    const result: ConfirmAssignmentsResponseData = await confirmAutoDispatchAssignments(
      projectId,
      validationResult.data.confirmations,
      userId
    );

    return NextResponse.json<ApiResponse<ConfirmAssignmentsResponseData>>(
      {
        success: true,
        data: result,
        message: `Đã phê duyệt và lên lịch trình thành công cho ${result.confirmedCount} nhiệm vụ`,
      },
      { status: 200 }
    );
  } catch (error: unknown) {
    console.error('POST /api/projects/:id/confirm-assignments Error:', error);

    if (error instanceof Error) {
      if (error.message === 'PROJECT_NOT_FOUND') {
        return NextResponse.json<ApiResponse>(
          {
            success: false,
            error: {
              code: 'PROJECT_NOT_FOUND',
              message: 'Project does not exist',
            },
          },
          { status: 404 }
        );
      }

      if (error.message.startsWith('TASK_NOT_FOUND')) {
        return NextResponse.json<ApiResponse>(
          {
            success: false,
            error: {
              code: 'TASK_NOT_FOUND',
              message: error.message,
            },
          },
          { status: 404 }
        );
      }

      return NextResponse.json<ApiResponse>(
        {
          success: false,
          error: {
            code: 'INTERNAL_SERVER_ERROR',
            message: error.message,
          },
        },
        { status: 500 }
      );
    }

    return NextResponse.json<ApiResponse>(
      {
        success: false,
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'An unknown error occurred while confirming task assignments',
        },
      },
      { status: 500 }
    );
  }
}
