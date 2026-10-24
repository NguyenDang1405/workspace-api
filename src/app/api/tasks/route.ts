import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { z } from 'zod';

const CreateTaskSchema = z.object({
  projectId: z.string().uuid(),
  parentTaskId: z.string().uuid().optional().nullable(),
  assignedTo: z.string().uuid().optional().nullable(),
  title: z.string().min(1),
  description: z.string().default(''),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional().default('MEDIUM'),
  status: z.enum(['SCHEDULED', 'TODO', 'IN_PROGRESS', 'REVIEW', 'DONE']).optional().default('TODO'),
  targetDepartment: z.enum(['FRONTEND', 'BACKEND', 'DEVOPS', 'QA', 'FULLSTACK']).optional().default('FULLSTACK'),
  requiredLevel: z.enum(['INTERN', 'FRESHER', 'JUNIOR', 'MIDDLE', 'SENIOR']).optional().default('JUNIOR'),
  estimatedHours: z.number().optional().default(4.0),
  checklist: z.array(z.object({ id: z.string(), text: z.string(), done: z.boolean() })).optional().default([]),
  isBlocked: z.boolean().optional().default(false),
  blockReason: z.string().max(255).optional().nullable(),
  startedAt: z.string().datetime().optional().nullable(),
  completedAt: z.string().datetime().optional().nullable(),
});

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get('projectId');
    const isBlockedParam = searchParams.get('isBlocked');
    const where: any = {};
    if (projectId) where.projectId = projectId;
    if (isBlockedParam !== null) where.isBlocked = isBlockedParam === 'true';

    const tasks = await prisma.task.findMany({
      where,
      include: {
        assignee: {
          select: {
            id: true,
            fullName: true,
            email: true,
            avatarUrl: true,
            talentProfile: { select: { level: true, department: true } },
          },
        },
        subTasks: true,
        statusHistories: {
          orderBy: { createdAt: 'desc' },
          take: 5,
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const formatted = tasks.map((t) => ({
      ...t,
      assignee: t.assignee
        ? {
            id: t.assignee.id,
            fullName: t.assignee.fullName,
            email: t.assignee.email,
            avatarUrl: t.assignee.avatarUrl,
            level: t.assignee.talentProfile?.level || 'JUNIOR',
            department: t.assignee.talentProfile?.department || 'FULLSTACK',
          }
        : null,
    }));

    return NextResponse.json(formatted);
  } catch (error) {
    console.error('GET /api/tasks Error:', error);
    return NextResponse.json({ error: 'Failed to fetch tasks' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const data = CreateTaskSchema.parse(body);

    // MOD-13: Adaptive Auto-Assignment & Approval Bypass for Personal Projects
    const project = await prisma.project.findUnique({
      where: { id: data.projectId },
      select: { id: true, isPersonalMode: true, ownerId: true },
    });

    if (project?.isPersonalMode && !data.assignedTo) {
      data.assignedTo = project.ownerId;
      if (!body.status || body.status === 'SCHEDULED') {
        data.status = 'TODO';
      }
    }

    const initialStartedAt = data.status === 'IN_PROGRESS' ? (data.startedAt ? new Date(data.startedAt) : new Date()) : (data.startedAt ? new Date(data.startedAt) : null);
    const initialCompletedAt = data.status === 'DONE' ? (data.completedAt ? new Date(data.completedAt) : new Date()) : (data.completedAt ? new Date(data.completedAt) : null);

    const task = await prisma.task.create({
      data: {
        ...data,
        startedAt: initialStartedAt,
        completedAt: initialCompletedAt,
        blockReason: data.isBlocked ? data.blockReason : null,
        statusHistories: {
          create: {
            fromStatus: 'CREATED',
            toStatus: data.status,
            durationInPreviousStatusHours: 0,
            changedBy: data.assignedTo,
          },
        },
      },
      include: {
        assignee: {
          select: {
            id: true,
            fullName: true,
            email: true,
            avatarUrl: true,
            talentProfile: { select: { level: true, department: true } },
          },
        },
        statusHistories: true,
      },
    });

    const formatted = {
      ...task,
      assignee: task.assignee
        ? {
            id: task.assignee.id,
            fullName: task.assignee.fullName,
            email: task.assignee.email,
            avatarUrl: task.assignee.avatarUrl,
            level: task.assignee.talentProfile?.level || 'JUNIOR',
            department: task.assignee.talentProfile?.department || 'FULLSTACK',
          }
        : null,
    };

    return NextResponse.json(formatted, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Validation failed', details: error.errors }, { status: 400 });
    }
    console.error('POST /api/tasks Error:', error);
    return NextResponse.json({ error: 'Failed to create task' }, { status: 500 });
  }
}
