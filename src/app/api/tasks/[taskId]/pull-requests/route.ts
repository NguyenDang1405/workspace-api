import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { GitPRDto, TaskPullRequestsResponseData } from '@/types/git.types';
import { ApiResponse } from '@/types';

export const dynamic = 'force-dynamic';

interface RouteParams {
  params: {
    taskId: string;
  };
}

/**
 * GET /api/tasks/[taskId]/pull-requests
 *
 * Retrieves all GitHub Pull Requests linked to the given task,
 * including AI verification scores, feedbacks, and merge statuses.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { taskId } = params;
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

    // 2. Task ID Validation
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

    // 3. Verify Task Exists
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: { id: true, title: true },
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

    // 4. Query Linked Pull Requests
    const prs = await prisma.gitPullRequest.findMany({
      where: { taskId },
      orderBy: { createdAt: 'desc' },
    });

    const pullRequests: GitPRDto[] = prs.map((pr) => ({
      id: pr.id,
      taskId: pr.taskId,
      prNumber: pr.prNumber,
      prUrl: pr.prUrl,
      branchName: pr.branchName,
      authorGithubUsername: pr.authorGithubUsername,
      diffSummary: pr.diffSummary,
      aiVerificationFeedback: pr.aiVerificationFeedback,
      isVerifiedByAi: pr.isVerifiedByAi,
      status: pr.status,
      mergedAt: pr.mergedAt ? pr.mergedAt.toISOString() : null,
      createdAt: pr.createdAt.toISOString(),
    }));

    const responseData: TaskPullRequestsResponseData = {
      taskId,
      pullRequests,
    };

    return NextResponse.json<ApiResponse<TaskPullRequestsResponseData>>(
      {
        success: true,
        data: responseData,
        message: 'Pull requests retrieved successfully',
      },
      { status: 200 }
    );
  } catch (error: unknown) {
    console.error('GET /api/tasks/[taskId]/pull-requests Error:', error);
    return NextResponse.json<ApiResponse>(
      {
        success: false,
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to retrieve pull requests',
        },
      },
      { status: 500 }
    );
  }
}

