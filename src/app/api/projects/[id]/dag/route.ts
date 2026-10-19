import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { isEdgeCritical } from '@/services/cpm.service';
import {
  ReactFlowTaskNode,
  ReactFlowDAGEdge,
  DAGGraphResponse,
} from '@/types/dag.types';
import { ApiResponse } from '@/types';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: {
    id: string;
  };
}

export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const projectId = params.id;
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

    // 1. Verify Project Exists
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, name: true },
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

    // 2. Fetch Tasks and Task Dependencies
    const [tasks, dependencies] = await Promise.all([
      prisma.task.findMany({
        where: { projectId },
        include: {
          assignee: {
            select: {
              fullName: true,
            },
          },
        },
        orderBy: [{ earlyStart: 'asc' }, { createdAt: 'asc' }],
      }),
      prisma.taskDependency.findMany({
        where: {
          predecessor: { projectId },
        },
      }),
    ]);

    // 3. Compute Project Makespan
    let projectMakespan = 0;
    const taskMap = new Map<string, (typeof tasks)[0]>();

    tasks.forEach((t) => {
      taskMap.set(t.id, t);
      const ef = Number(t.earlyFinish || 0);
      if (ef > projectMakespan) {
        projectMakespan = ef;
      }
    });

    // 4. Map Nodes for React Flow
    const nodes: ReactFlowTaskNode[] = tasks.map((task) => {
      return {
        id: task.id,
        type: 'taskNode',
        data: {
          title: task.title,
          department: task.targetDepartment,
          level: task.requiredLevel,
          estimatedHours: Number(task.estimatedHours),
          earlyStart: Number(task.earlyStart),
          earlyFinish: Number(task.earlyFinish),
          lateStart: Number(task.lateStart),
          lateFinish: Number(task.lateFinish),
          slackTime: Number(task.slackTime),
          isCriticalPath: Boolean(task.isCriticalPath),
          status: task.status,
          priority: task.priority,
          assignedTo: task.assignedTo,
          assigneeName: task.assignee?.fullName || null,
        },
        position: { x: 0, y: 0 }, // Position calculated dynamically on client by dagre
      };
    });

    // 5. Map Edges for React Flow and Highlight Critical Edges
    const edges: ReactFlowDAGEdge[] = dependencies.map((dep) => {
      const pred = taskMap.get(dep.predecessorId);
      const succ = taskMap.get(dep.successorId);

      const isCritical =
        pred && succ
          ? isEdgeCritical(
              {
                earlyFinish: Number(pred.earlyFinish),
                isCriticalPath: Boolean(pred.isCriticalPath),
              },
              {
                earlyStart: Number(succ.earlyStart),
                isCriticalPath: Boolean(succ.isCriticalPath),
              }
            )
          : false;

      return {
        id: `e-${dep.predecessorId}-${dep.successorId}`,
        source: dep.predecessorId,
        target: dep.successorId,
        animated: isCritical,
        style: {
          stroke: isCritical ? '#ef4444' : '#94a3b8',
          strokeWidth: isCritical ? 3 : 1.5,
        },
        data: {
          isCriticalEdge: isCritical,
        },
      };
    });

    const criticalTasksCount = tasks.filter((t) => t.isCriticalPath).length;

    const responseData: DAGGraphResponse = {
      nodes,
      edges,
      projectMakespan,
      totalTasks: tasks.length,
      criticalTasksCount,
    };

    const responseBody: ApiResponse<DAGGraphResponse> = {
      success: true,
      data: responseData,
    };

    return NextResponse.json(responseBody, { status: 200 });
  } catch (error) {
    console.error('GET /api/projects/[id]/dag Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to retrieve project DAG graph',
          details: error instanceof Error ? error.message : String(error),
        },
      },
      { status: 500 }
    );
  }
}

