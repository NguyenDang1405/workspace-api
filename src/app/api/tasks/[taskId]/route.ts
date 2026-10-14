import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { z } from 'zod';

const UpdateTaskSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
  status: z.enum(['SCHEDULED', 'TODO', 'IN_PROGRESS', 'REVIEW', 'DONE']).optional(),
  assignedTo: z.string().uuid().optional().nullable(),
  targetDepartment: z.enum(['FRONTEND', 'BACKEND', 'DEVOPS', 'QA', 'FULLSTACK']).optional(),
  requiredLevel: z.enum(['INTERN', 'FRESHER', 'JUNIOR', 'MIDDLE', 'SENIOR']).optional(),
  estimatedHours: z.number().optional(),
  checklist: z.array(z.object({ id: z.string(), text: z.string(), done: z.boolean() })).optional(),
  isBlocked: z.boolean().optional(),
  blockReason: z.string().max(255).optional().nullable(),
  startedAt: z.string().datetime().optional().nullable(),
  completedAt: z.string().datetime().optional().nullable(),
});

export async function GET(request: Request, { params }: { params: { taskId: string } }) {
  try {
    const task = await prisma.task.findUnique({
      where: { id: params.taskId },
      include: {
        assignee: {
          select: {
            id: true,
            fullName: true,
            email: true,
            avatarUrl: true,
            talentProfile: { select: { department: true, level: true } },
          },
        },
        project: true,
        parentTask: true,
        subTasks: true,
        statusHistories: {
          orderBy: { createdAt: 'desc' },
          include: {
            changer: { select: { id: true, fullName: true, avatarUrl: true } },
          },
        },
      },
    });
    if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    
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
    return NextResponse.json(formatted);
  } catch (error) {
    console.error('GET /api/tasks/[taskId] Error:', error);
    return NextResponse.json({ error: 'Failed to fetch task' }, { status: 500 });
  }
}

export async function PUT(request: Request, { params }: { params: { taskId: string } }) {
  try {
    const body = await request.json();
    const data = UpdateTaskSchema.parse(body);

    const currentTask = await prisma.task.findUnique({
      where: { id: params.taskId },
      include: {
        statusHistories: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    if (!currentTask) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    const updateData: any = { ...data };

    // Format timestamps if provided
    if (data.startedAt !== undefined) {
      updateData.startedAt = data.startedAt ? new Date(data.startedAt) : null;
    }
    if (data.completedAt !== undefined) {
      updateData.completedAt = data.completedAt ? new Date(data.completedAt) : null;
    }

    // Handle blocking logic
    if (data.isBlocked !== undefined) {
      updateData.isBlocked = data.isBlocked;
      if (!data.isBlocked) {
        updateData.blockReason = null;
      }
    }

    // Handle status transition & cycle time tracking
    if (data.status && data.status !== currentTask.status) {
      const lastStatusTime = currentTask.statusHistories[0]?.createdAt || currentTask.updatedAt || currentTask.createdAt;
      const durationMs = Date.now() - new Date(lastStatusTime).getTime();
      const durationInHours = Math.max(0, Math.round((durationMs / (1000 * 60 * 60)) * 100) / 100);

      if (data.status === 'IN_PROGRESS' && !currentTask.startedAt && updateData.startedAt === undefined) {
        updateData.startedAt = new Date();
      }
      if (data.status === 'DONE' && updateData.completedAt === undefined) {
        updateData.completedAt = new Date();
      }

      // Record status transition in task_status_history
      await prisma.taskStatusHistory.create({
        data: {
          taskId: params.taskId,
          fromStatus: currentTask.status,
          toStatus: data.status,
          durationInPreviousStatusHours: durationInHours,
          changedBy: data.assignedTo || currentTask.assignedTo || null,
        },
      });
    }

    const updatedTask = await prisma.task.update({
      where: { id: params.taskId },
      data: updateData,
      include: {
        assignee: { select: { id: true, fullName: true, email: true, avatarUrl: true } },
        statusHistories: {
          orderBy: { createdAt: 'desc' },
          take: 5,
        },
      },
    });

    return NextResponse.json(updatedTask);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Validation failed', details: error.errors }, { status: 400 });
    }
    console.error('PUT /api/tasks/[taskId] Error:', error);
    return NextResponse.json({ error: 'Failed to update task' }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: { taskId: string } }) {
  try {
    await prisma.task.delete({ where: { id: params.taskId } });
    return NextResponse.json({ message: 'Task deleted successfully' });
  } catch (error) {
    console.error('DELETE /api/tasks/[taskId] Error:', error);
    return NextResponse.json({ error: 'Failed to delete task' }, { status: 500 });
  }
}
