import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { CandidatesQuerySchema } from '@/types/retrieval.types';
import { searchCandidatesForTask } from '@/services/hybrid-search.service';
import { ApiResponse } from '@/types';

export const dynamic = 'force-dynamic';

interface RouteParams {
  params: {
    taskId: string;
  };
}

/**
 * GET /api/tasks/[taskId]/candidates
 *
 * Retrieves ranked candidate recommendations for a given task using
 * PostgreSQL Hybrid Search (RRF = BM25 + Vector Cosine, k = 60).
 *
 * Security & RBAC:
 * - Requires Bearer token verified by middleware.
 * - Allowed roles: ADMIN, PM, LEADER.
 * - MEMBER is rejected with HTTP 403 Forbidden.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { taskId } = params;
    const userId = request.headers.get('x-user-id');
    const userRole = request.headers.get('x-user-role');

    // 1. Authentication check
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

    // 2. RBAC check: Members are strictly forbidden
    if (userRole === 'MEMBER') {
      return NextResponse.json<ApiResponse>(
        {
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: 'Members are not authorized to view candidate recommendations',
          },
        },
        { status: 403 }
      );
    }

    // 3. Task ID validation
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

    // 4. Query parameters validation
    const { searchParams } = new URL(request.url);
    const queryValidation = CandidatesQuerySchema.safeParse({
      limit: searchParams.get('limit') ?? undefined,
      allowCrossDept: searchParams.get('allowCrossDept') ?? undefined,
    });

    if (!queryValidation.success) {
      return NextResponse.json<ApiResponse>(
        {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid query parameters',
            details: queryValidation.error.flatten(),
          },
        },
        { status: 400 }
      );
    }

    const { limit, allowCrossDept } = queryValidation.data;

    // 5. Execute Hybrid Search (RRF k=60)
    const candidates = await searchCandidatesForTask(taskId, limit, allowCrossDept);

    return NextResponse.json<ApiResponse>(
      {
        success: true,
        data: {
          taskId,
          candidates,
        },
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

      if (error.message === 'EMBEDDING_GENERATION_FAILED') {
        return NextResponse.json<ApiResponse>(
          {
            success: false,
            error: {
              code: 'EMBEDDING_GENERATION_FAILED',
              message: 'Failed to generate embedding for the task query',
            },
          },
          { status: 500 }
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

    console.error('GET /api/tasks/[taskId]/candidates Error:', error);
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

