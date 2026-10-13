import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { z } from 'zod';

const UpdateTaskSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
  status: z.enum(['TODO', 'IN_PROGRESS', 'REVIEW', 'DONE']).optional(),
  assignedTo: z.string().uuid().optional().nullable(),
  requiredLevel: z.string().optional(),
  checklist: z.array(z.object({ id: z.string(), text: z.string(), done: z.boolean() })).optional(),
});

export async function GET(request: Request, { params }: { params: { taskId: string } }) {
  try {
    const task = await prisma.task.findUnique({
      where: { id: params.taskId },
      include: {
        assignee: { select: { id: true, fullName: true, email: true, avatarUrl: true, level: true, department: true } },
        project: true,
        parentTask: true,
        subTasks: true,
      },
    });
    if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    return NextResponse.json(task);
  } catch (error) {
    console.error('GET /api/tasks/[taskId] Error:', error);
    return NextResponse.json({ error: 'Failed to fetch task' }, { status: 500 });
  }
}

export async function PUT(request: Request, { params }: { params: { taskId: string } }) {
  try {
    const body = await request.json();
    const data = UpdateTaskSchema.parse(body);
    const task = await prisma.task.update({
      where: { id: params.taskId },
      data,
      include: { assignee: { select: { id: true, fullName: true, email: true, avatarUrl: true } } },
    });
    return NextResponse.json(task);
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
