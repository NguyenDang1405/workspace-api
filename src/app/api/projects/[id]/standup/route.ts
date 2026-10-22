import { NextResponse, type NextRequest } from 'next/server';
import { GenerateStandupSchema, StandupReportDto } from '@/types/standup.types';
import {
  generateDailyStandupForProject,
  getDailyStandupForProject,
} from '@/services/standup-generator.service';
import { ApiResponse } from '@/types';

export const dynamic = 'force-dynamic';

interface RouteParams {
  params: {
    id: string;
  };
}

/**
 * GET /api/projects/[id]/standup
 *
 * Retrieves the Daily Standup report for the specified date (defaults to today).
 * RBAC: Accessible to all authenticated project members (ADMIN, PM, LEADER, MEMBER).
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const projectId = params.id;
    const currentUserId = request.headers.get('x-user-id');

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

    const { searchParams } = new URL(request.url);
    const dateParam = searchParams.get('date') || undefined;

    const report = await getDailyStandupForProject(projectId, dateParam);

    if (!report) {
      return NextResponse.json<ApiResponse>(
        {
          success: false,
          error: {
            code: 'STANDUP_REPORT_NOT_FOUND',
            message: `Chưa có báo cáo Daily Standup cho ngày ${dateParam || 'hôm nay'}`,
          },
        },
        { status: 404 }
      );
    }

    return NextResponse.json<ApiResponse<StandupReportDto>>(
      {
        success: true,
        data: report,
      },
      { status: 200 }
    );
  } catch (error: any) {
    console.error('[Get Daily Standup Error]:', error);
    return NextResponse.json<ApiResponse>(
      {
        success: false,
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: error.message || 'Không thể lấy báo cáo Daily Standup',
        },
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/projects/[id]/standup
 *
 * Automatically aggregates 24h project events, calls OpenAI for synthesis,
 * calculates real-time flow metrics, and idempotently upserts the daily report.
 *
 * RBAC: Restricted to ADMIN, PM, and LEADER roles. MEMBER receives HTTP 403 Forbidden.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const projectId = params.id;
    const currentUserId = request.headers.get('x-user-id');
    const currentUserRole = request.headers.get('x-user-role');

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

    // RBAC: MEMBER role is forbidden from triggering report generation
    if (currentUserRole === 'MEMBER') {
      return NextResponse.json<ApiResponse>(
        {
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: 'Chỉ Leader, PM hoặc Admin mới có quyền sinh báo cáo Daily Standup',
          },
        },
        { status: 403 }
      );
    }

    let bodyJson: unknown = {};
    try {
      const text = await request.text();
      if (text && text.trim().length > 0) {
        bodyJson = JSON.parse(text);
      }
    } catch (_) {
      // Body may be empty, which uses default schema values
    }

    const validationResult = GenerateStandupSchema.safeParse(bodyJson);
    if (!validationResult.success) {
      return NextResponse.json<ApiResponse>(
        {
          success: false,
          error: {
            code: 'INVALID_INPUT',
            message: 'Dữ liệu yêu cầu sinh standup không hợp lệ',
            details: validationResult.error.format(),
          },
        },
        { status: 400 }
      );
    }

    const report = await generateDailyStandupForProject(
      projectId,
      validationResult.data.reportDate
    );

    return NextResponse.json<ApiResponse<StandupReportDto>>(
      {
        success: true,
        data: report,
      },
      { status: 201 }
    );
  } catch (error: any) {
    console.error('[Generate Daily Standup Error]:', error);

    if (error.message === 'PROJECT_NOT_FOUND') {
      return NextResponse.json<ApiResponse>(
        {
          success: false,
          error: {
            code: 'PROJECT_NOT_FOUND',
            message: 'Không tìm thấy dự án tương ứng',
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
          message: error.message || 'Không thể tạo báo cáo Daily Standup',
        },
      },
      { status: 500 }
    );
  }
}

