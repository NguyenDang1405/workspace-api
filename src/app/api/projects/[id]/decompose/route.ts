import { NextResponse, type NextRequest } from 'next/server';
import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { openai, generateTaskEmbedding } from '@/lib/openai';
import { zodResponseFormat } from 'openai/helpers/zod';
import {
  DecomposeProjectResponseSchema,
  TaskItemGenerated,
  TaskNodeInput,
} from '@/types/dag.types';
import { runKahnAndCPM, CyclicDependencyError } from '@/services/cpm.service';
import { ApiResponse } from '@/types';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: {
    id: string;
  };
}

/**
 * Fallback heuristic decomposition if OpenAI API is unavailable (DoD Layer 5).
 */
function generateFallbackTasks(projectName: string, techStack: string[]): TaskItemGenerated[] {
  const stackStr = techStack.join(', ') || 'PostgreSQL, Next.js, TypeScript';
  return [
    {
      tempId: 'T1',
      title: 'Thiết kế Lược đồ CSDL & Khởi tạo Migration',
      description: `Thiết kế cơ sở dữ liệu quan hệ, bảng dữ liệu và quan hệ khóa ngoại cho ${projectName}. Công nghệ: ${stackStr}.`,
      targetDepartment: 'BACKEND',
      requiredLevel: 'SENIOR',
      priority: 'HIGH',
      estimatedHours: 8,
      predecessorTempIds: [],
    },
    {
      tempId: 'T2',
      title: 'Xây dựng Core API & Xác thực người dùng (Auth)',
      description: 'Phát triển tầng REST API, JWT authentication, middleware bảo vệ và RBAC.',
      targetDepartment: 'BACKEND',
      requiredLevel: 'MIDDLE',
      priority: 'HIGH',
      estimatedHours: 12,
      predecessorTempIds: ['T1'],
    },
    {
      tempId: 'T3',
      title: 'Thiết kế Giao diện UI & Design System Component',
      description: 'Dựng khung layout, components UI dùng chung, Tailwind CSS và responsive view.',
      targetDepartment: 'FRONTEND',
      requiredLevel: 'JUNIOR',
      priority: 'MEDIUM',
      estimatedHours: 10,
      predecessorTempIds: ['T1'],
    },
    {
      tempId: 'T4',
      title: 'Tích hợp Frontend Client với Backend APIs',
      description: 'Kết nối React Query / Axios gọi các endpoints backend, xử lý form state và loading.',
      targetDepartment: 'FRONTEND',
      requiredLevel: 'MIDDLE',
      priority: 'MEDIUM',
      estimatedHours: 14,
      predecessorTempIds: ['T2', 'T3'],
    },
    {
      tempId: 'T5',
      title: 'Thiết lập Docker Container & Pipeline CI/CD',
      description: 'Viết Dockerfile, docker-compose đa dịch vụ và kịch bản deploy tự động.',
      targetDepartment: 'DEVOPS',
      requiredLevel: 'MIDDLE',
      priority: 'MEDIUM',
      estimatedHours: 8,
      predecessorTempIds: ['T2'],
    },
    {
      tempId: 'T6',
      title: 'Kiểm thử Tích hợp (E2E & Stress Testing)',
      description: 'Viết test cases kiểm thử luồng nghiệp vụ end-to-end, kiểm tra tải và bảo mật.',
      targetDepartment: 'QA',
      requiredLevel: 'JUNIOR',
      priority: 'LOW',
      estimatedHours: 8,
      predecessorTempIds: ['T4', 'T5'],
    },
  ];
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const projectId = params.id;
    const userRole = request.headers.get('x-user-role');
    const userId = request.headers.get('x-user-id');

    if (!userId) {
      return NextResponse.json(
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

    // 1. RBAC Check: Only ADMIN, PM, or LEADER can decompose projects
    if (userRole === 'MEMBER') {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: 'Members are not authorized to decompose project tasks',
          },
        },
        { status: 403 }
      );
    }

    // 2. Query Project
    const project = await prisma.project.findUnique({
      where: { id: projectId },
    });

    if (!project) {
      return NextResponse.json(
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

    // Optional user prompt or instructions from body
    let userInstructions = '';
    try {
      const body = await request.json();
      if (body?.instructions) {
        userInstructions = String(body.instructions);
      }
    } catch {
      // Body is optional
    }

    // 3. Call OpenAI Structured Outputs (with Graceful Fallback)
    let generatedTasks: TaskItemGenerated[] = [];

    const systemPrompt = `Bạn là Giám đốc Kỹ thuật (Technical Architect & PMP Specialist).
Nhiệm vụ của bạn là phân rã dự án phần mềm thành danh sách từ 5 đến 15 tác vụ kỹ thuật theo cấu trúc Đồ thị có hướng không chu trình (DAG).
Yêu cầu bắt buộc:
1. Mỗi tác vụ phải có tempId định dạng T1, T2, T3...
2. title và description thể hiện rõ mục tiêu kỹ thuật.
3. targetDepartment thuộc một trong: FRONTEND, BACKEND, DEVOPS, QA, FULLSTACK.
4. requiredLevel thuộc một trong: INTERN, FRESHER, JUNIOR, MIDDLE, SENIOR.
5. priority: LOW, MEDIUM, HIGH, URGENT.
6. estimatedHours: thời lượng ước tính từ 1 đến 40 giờ.
7. predecessorTempIds: mảng chứa các tempId của những task phải HOÀN THÀNH TRƯỚC task này.
   - Luôn tuân thủ logic tự nhiên: Database trước Backend API, Backend trước Frontend Integration, Dev hoàn thiện trước E2E QA.
   - TUYỆT ĐỐI KHÔNG TẠO CHU TRÌNH VÒNG TRÒN (A phụ thuộc B và B phụ thuộc A).`;

    const userMessage = `Dự án cần phân rã:
- Tên dự án: ${project.name}
- Mô tả: ${project.description}
- Công nghệ chính: ${project.techStack.join(', ') || 'Fullstack Web'}
- Độ phức tạp: ${project.complexity}
${userInstructions ? `- Yêu cầu bổ sung của quản lý: ${userInstructions}` : ''}`;

    try {
      const completion = await openai.beta.chat.completions.parse({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        response_format: zodResponseFormat(
          DecomposeProjectResponseSchema,
          'project_decomposition'
        ),
      });

      const parsed = completion.choices[0]?.message?.parsed;
      if (parsed && Array.isArray(parsed.tasks) && parsed.tasks.length > 0) {
        generatedTasks = parsed.tasks;
      } else {
        throw new Error('OpenAI returned empty task list');
      }
    } catch (aiError) {
      console.warn('OpenAI decomposition call failed, activating graceful fallback:', aiError);
      generatedTasks = generateFallbackTasks(project.name, project.techStack);
    }

    // 4. Transform to CPM Input and Execute Kahn's + CPM Algorithm
    const cpmInputs: TaskNodeInput[] = generatedTasks.map((t) => ({
      tempId: t.tempId,
      estimatedHours: t.estimatedHours,
      predecessors: t.predecessorTempIds,
    }));

    let cpmResult;
    try {
      cpmResult = runKahnAndCPM(cpmInputs);
    } catch (algError) {
      if (algError instanceof CyclicDependencyError) {
        return NextResponse.json(
          {
            success: false,
            error: {
              code: 'CYCLIC_DEPENDENCY_DETECTED',
              message: algError.message,
            },
          },
          { status: 422 }
        );
      }
      throw algError;
    }

    // 5. Generate Semantic Vector Embeddings for Each Task (1536 dims, parallel)
    const embeddings = await Promise.all(
      generatedTasks.map((t) => generateTaskEmbedding(t.title, t.description))
    );

    // 6. Atomic PostgreSQL Transaction: Persist Tasks & Dependencies
    const idMap = new Map<string, string>(); // tempId -> Database UUID
    generatedTasks.forEach((t) => {
      idMap.set(t.tempId, crypto.randomUUID());
    });

    const tasksToInsert = generatedTasks.map((t) => {
      const taskId = idMap.get(t.tempId)!;
      const cpm = cpmResult.cpmResults.get(t.tempId)!;

      return {
        id: taskId,
        projectId: project.id,
        title: t.title,
        description: t.description,
        priority: t.priority || 'MEDIUM',
        targetDepartment: t.targetDepartment,
        requiredLevel: t.requiredLevel,
        estimatedHours: new Prisma.Decimal(t.estimatedHours),
        actualHours: null,
        status: 'SCHEDULED' as const,
        checklist: [],
        earlyStart: new Prisma.Decimal(cpm.earlyStart),
        earlyFinish: new Prisma.Decimal(cpm.earlyFinish),
        lateStart: new Prisma.Decimal(cpm.lateStart),
        lateFinish: new Prisma.Decimal(cpm.lateFinish),
        slackTime: new Prisma.Decimal(cpm.slackTime),
        isCriticalPath: cpm.isCriticalPath,
        dueDate: null,
        inReviewAt: null,
      };
    });

    const dependenciesToInsert: {
      predecessorId: string;
      successorId: string;
      dependencyType: string;
    }[] = [];

    generatedTasks.forEach((t) => {
      const currentTaskId = idMap.get(t.tempId)!;
      t.predecessorTempIds.forEach((predTempId) => {
        const predTaskId = idMap.get(predTempId);
        if (predTaskId && predTaskId !== currentTaskId) {
          dependenciesToInsert.push({
            predecessorId: predTaskId,
            successorId: currentTaskId,
            dependencyType: 'FS',
          });
        }
      });
    });

    await prisma.$transaction(async (tx) => {
      // 1. Delete previous tasks for this project if re-decomposing
      await tx.task.deleteMany({
        where: { projectId: project.id },
      });

      // 2. Insert new tasks batch
      await tx.task.createMany({
        data: tasksToInsert,
      });

      // 3. Persist semantic embeddings directly into task_embedding vector column
      for (let i = 0; i < tasksToInsert.length; i++) {
        const emb = embeddings[i];
        if (emb && emb.length === 1536) {
          const vectorStr = `[${emb.join(',')}]`;
          await tx.$executeRawUnsafe(
            `UPDATE tasks SET task_embedding = $1::vector WHERE id = $2::uuid`,
            vectorStr,
            tasksToInsert[i].id
          );
        }
      }

      // 4. Insert dependencies batch
      if (dependenciesToInsert.length > 0) {
        await tx.taskDependency.createMany({
          data: dependenciesToInsert,
          skipDuplicates: true,
        });
      }
    });

    // 6. Return standard ApiResponse Envelope
    const responseBody: ApiResponse = {
      success: true,
      data: {
        projectId: project.id,
        projectMakespan: cpmResult.projectMakespan,
        totalTasks: tasksToInsert.length,
        criticalTasksCount: cpmResult.criticalPath.length,
        criticalPathTempIds: cpmResult.criticalPath,
        tasks: tasksToInsert.map((t) => ({
          id: t.id,
          title: t.title,
          department: t.targetDepartment,
          level: t.requiredLevel,
          estimatedHours: Number(t.estimatedHours),
          earlyStart: Number(t.earlyStart),
          earlyFinish: Number(t.earlyFinish),
          lateStart: Number(t.lateStart),
          lateFinish: Number(t.lateFinish),
          slackTime: Number(t.slackTime),
          isCriticalPath: t.isCriticalPath,
        })),
      },
      message: 'Project successfully decomposed into DAG with CPM metrics',
    };

    return NextResponse.json(responseBody, { status: 200 });
  } catch (error) {
    console.error('POST /api/projects/[id]/decompose Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to decompose project',
          details: error instanceof Error ? error.message : String(error),
        },
      },
      { status: 500 }
    );
  }
}

