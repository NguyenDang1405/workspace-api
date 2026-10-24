import { NextResponse, type NextRequest } from 'next/server';
import { generateAutoDispatchPlan } from '@/services/auto-dispatch-scheduler.service';
import { ApiResponse } from '@/types';
import { AutoDispatchPlanResponseData } from '@/types/auto-dispatch.types';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: {
    id: string;
  };
}

/**
 * POST /api/projects/:id/auto-dispatch-plan
 *
 * Generates an AI-driven preview auto-dispatch & timeline schedule plan for a project.
 * Implements Human-in-the-Loop review for project Leaders and Admins.
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

    // 2. RBAC Check: Only LEADER, PM, or ADMIN can generate auto-dispatch plans
    if (userRole === 'MEMBER') {
      return NextResponse.json<ApiResponse>(
        {
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: 'Members are not authorized to access auto-dispatch planning',
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

    // 4. Generate Auto-Dispatch Preview Plan
    const plan: AutoDispatchPlanResponseData = await generateAutoDispatchPlan(
      projectId,
      userId
    );

    return NextResponse.json<ApiResponse<AutoDispatchPlanResponseData>>(
      {
        success: true,
        data: plan,
        message: `Generated auto-dispatch plan for ${plan.totalTasks} tasks successfully`,
      },
      { status: 200 }
    );
  } catch (error: unknown) {
    console.error('POST /api/projects/:id/auto-dispatch-plan Error:', error);

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
          message: 'An unknown error occurred during auto-dispatch planning',
        },
      },
      { status: 500 }
    );
  }
}
