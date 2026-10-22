import { NextResponse, type NextRequest } from 'next/server';
import { SeedFromSrsResult } from '@/types/srs.types';
import { seedProjectFromSRS } from '@/services/srs-extractor.service';
import { ApiResponse } from '@/types';

export const dynamic = 'force-dynamic';

interface RouteParams {
  params: {
    id: string;
  };
}

/**
 * POST /api/projects/[id]/seed-from-srs
 *
 * End-to-End Automated Project Initialization:
 * Reads extracted User Stories from the latest SRS document, calculates CPM schedule
 * metrics, generates semantic embeddings, and creates the full task DAG.
 *
 * RBAC: Restricted to ADMIN, PM, and LEADER roles.
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

    // RBAC: MEMBER is forbidden from seeding projects
    if (currentUserRole === 'MEMBER') {
      return NextResponse.json<ApiResponse>(
        {
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: 'Chỉ Leader, PM hoặc Admin mới có quyền khởi tạo dự án từ SRS',
          },
        },
        { status: 403 }
      );
    }

    const result = await seedProjectFromSRS(projectId);

    return NextResponse.json<ApiResponse<SeedFromSrsResult>>(
      {
        success: true,
        message: 'Khởi tạo toàn bộ DAG tác vụ từ SRS thành công',
        data: result,
      },
      { status: 200 }
    );
  } catch (error: any) {
    console.error('[Seed From SRS Error]:', error);

    if (error.message === 'NO_SRS_DOCUMENT_FOUND') {
      return NextResponse.json<ApiResponse>(
        {
          success: false,
          error: {
            code: 'NO_SRS_DOCUMENT_FOUND',
            message: 'Chưa có tài liệu SRS nào được tải lên cho dự án này',
          },
        },
        { status: 400 }
      );
    }

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
          message: error.message || 'Không thể khởi tạo dự án từ tài liệu SRS',
        },
      },
      { status: 500 }
    );
  }
}

