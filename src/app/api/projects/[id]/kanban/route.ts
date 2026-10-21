import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getProjectKanbanBoard } from '@/services/kanban-flow.service';
import { ApiResponse } from '@/types';

export const dynamic = 'force-dynamic';

interface RouteParams {
  params: {
    id: string;
  };
}

/**
 * GET /api/projects/[id]/kanban
 *
 * Retrieves the 5-column Kanban board (SCHEDULED, TODO, IN_PROGRESS, REVIEW, DONE),
 * dynamic IQR bottleneck threshold, checklist progress, and flags bottleneck tasks.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const projectId = params.id;
    const currentUserId = request.headers.get('x-user-id');

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

    // 2. Validate Project Exists
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, name: true },
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

    // 3. Retrieve Kanban Board with dynamic IQR analysis
    const boardData = await getProjectKanbanBoard(projectId);

    return NextResponse.json<ApiResponse>(
      {
        success: true,
        data: boardData,
        message: 'Kanban board retrieved successfully',
      },
      { status: 200 }
    );
  } catch (error: unknown) {
    console.error('GET /api/projects/[id]/kanban Error:', error);
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

