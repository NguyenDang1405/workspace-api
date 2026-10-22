import { NextResponse, type NextRequest } from 'next/server';
import { IngestDocumentSchema, ExtractedStoriesResult, ProjectDocumentDto } from '@/types/srs.types';
import { ingestSRSDocument, getProjectDocuments } from '@/services/srs-extractor.service';
import { ApiResponse } from '@/types';

export const dynamic = 'force-dynamic';

interface RouteParams {
  params: {
    id: string;
  };
}

/**
 * GET /api/projects/[id]/documents
 *
 * Retrieves all uploaded SRS documents and their extracted User Stories for the project.
 * Accessible to all authenticated project members (ADMIN, PM, LEADER, MEMBER).
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

    const documents = await getProjectDocuments(projectId);

    return NextResponse.json<ApiResponse<ProjectDocumentDto[]>>(
      {
        success: true,
        data: documents,
      },
      { status: 200 }
    );
  } catch (error: any) {
    console.error('[Get Project Documents Error]:', error);
    return NextResponse.json<ApiResponse>(
      {
        success: false,
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: error.message || 'Không thể lấy danh sách tài liệu',
        },
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/projects/[id]/documents
 *
 * Ingests an SRS document, performs recursive text chunking, extracts INVEST-compliant
 * User Stories via OpenAI Structured Outputs, and stores them in project_documents.
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

    // RBAC: MEMBER role is forbidden from uploading SRS
    if (currentUserRole === 'MEMBER') {
      return NextResponse.json<ApiResponse>(
        {
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: 'Chỉ Leader, PM hoặc Admin mới có quyền tải lên tài liệu SRS',
          },
        },
        { status: 403 }
      );
    }

    const body = await request.json();
    const validationResult = IngestDocumentSchema.safeParse(body);

    if (!validationResult.success) {
      return NextResponse.json<ApiResponse>(
        {
          success: false,
          error: {
            code: 'INVALID_INPUT',
            message: 'Dữ liệu tài liệu tải lên không hợp lệ',
            details: validationResult.error.format(),
          },
        },
        { status: 400 }
      );
    }

    const { fileName, fileUrl, rawContent } = validationResult.data;

    const result = await ingestSRSDocument(projectId, fileName, fileUrl, rawContent);

    return NextResponse.json<ApiResponse<ExtractedStoriesResult>>(
      {
        success: true,
        data: result,
      },
      { status: 201 }
    );
  } catch (error: any) {
    console.error('[Ingest Document Error]:', error);

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
          message: error.message || 'Không thể tiếp nhận và trích xuất tài liệu',
        },
      },
      { status: 500 }
    );
  }
}

