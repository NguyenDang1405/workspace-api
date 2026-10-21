import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getProjectFlowMetrics } from '@/services/kanban-flow.service';
import { ApiResponse } from '@/types';

export const dynamic = 'force-dynamic';

interface RouteParams {
  params: {
    id: string;
  };
}

/**
 * GET /api/projects/[id]/flow-metrics
 *
 * Retrieves project flow metrics:
 * - Work In Progress (WIP count)
 * - Throughput per day
 * - Average Cycle Time & Lead Time
 * - Little's Law Discrepancy (|L - lambda * W|)
 * - IQR upper fence bottleneck threshold
 * - Cumulative Flow Diagram (CFD) daily data points
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

    // 3. Parse and Validate Query Parameter: daysWindow
    const { searchParams } = new URL(request.url);
    const rawWindow = parseInt(searchParams.get('daysWindow') || '14', 10);
    const daysWindow = isNaN(rawWindow) ? 14 : Math.max(1, Math.min(90, rawWindow));

    // 4. Calculate Flow Observability & Little's Law Metrics
    const flowMetrics = await getProjectFlowMetrics(projectId, daysWindow);

    return NextResponse.json<ApiResponse>(
      {
        success: true,
        data: flowMetrics,
        message: 'Project flow metrics retrieved successfully',
      },
      { status: 200 }
    );
  } catch (error: unknown) {
    console.error('GET /api/projects/[id]/flow-metrics Error:', error);
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

