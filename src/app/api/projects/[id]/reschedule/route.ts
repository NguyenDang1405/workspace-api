import { NextResponse, type NextRequest } from 'next/server';
import { TriggerRescheduleSchema, ReschedulingResponseData } from '@/types/rescheduling.types';
import { executeDynamicReschedule } from '@/services/rescheduling-engine.service';
import { ApiResponse } from '@/types';

export const dynamic = 'force-dynamic';

interface RouteParams {
  params: {
    id: string;
  };
}

/**
 * POST /api/projects/[id]/reschedule
 *
 * Triggers dynamic CPM schedule recalculation, delay propagation analysis,
 * and AI mitigation strategy generation.
 *
 * RBAC: Restricted to ADMIN, PM, and LEADER roles.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const projectId = params.id;
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

    // 2. RBAC Guard: MEMBER is strictly forbidden
    if (currentUserRole === 'MEMBER') {
      return NextResponse.json<ApiResponse>(
        {
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: 'Members are not authorized to trigger project rescheduling',
          },
        },
        { status: 403 }
      );
    }

    // 3. Project ID Validation
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

    const validationResult = TriggerRescheduleSchema.safeParse(rawBody);
    if (!validationResult.success) {
      return NextResponse.json<ApiResponse>(
        {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid rescheduling payload',
            details: validationResult.error.flatten(),
          },
        },
        { status: 400 }
      );
    }

    const { triggerTaskId, reason, actualDelayHours } = validationResult.data;

    // 5. Execute Rescheduling Engine
    const rescheduleResult = await executeDynamicReschedule(
      projectId,
      triggerTaskId,
      actualDelayHours,
      reason
    );

    return NextResponse.json<ApiResponse<ReschedulingResponseData>>(
      {
        success: true,
        data: rescheduleResult,
        message: rescheduleResult.isDelayAbsorbed
          ? 'Delay completely absorbed by task slack time. Project makespan unchanged.'
          : 'Project schedule dynamically recalculated. Rescheduling event logged.',
      },
      { status: 200 }
    );
  } catch (error: unknown) {
    console.error('POST /api/projects/[id]/reschedule Error:', error);

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    let statusCode = 500;

    if (errorMessage === 'PROJECT_NOT_FOUND' || errorMessage === 'TRIGGER_TASK_NOT_FOUND') {
      statusCode = 404;
    } else if (errorMessage === 'PROJECT_HAS_NO_TASKS') {
      statusCode = 400;
    }

    return NextResponse.json<ApiResponse>(
      {
        success: false,
        error: {
          code: errorMessage,
          message: error instanceof Error ? error.message : 'Failed to reschedule project',
        },
      },
      { status: statusCode }
    );
  }
}

