import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { z } from 'zod';

const CreateTaskSchema = z.object({
  projectId: z.string().uuid(),
  parentTaskId: z.string().uuid().optional().nullable(),
  assignedTo: z.string().uuid().optional().nullable(),
  title: z.string().min(1),
  description: z.string().optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional().default('MEDIUM'),
  status: z.enum(['TODO', 'IN_PROGRESS', 'REVIEW', 'DONE']).optional().default('TODO'),
  requiredLevel: z.string().optional(),
  checklist: z.array(z.object({ id: z.string(), text: z.string(), done: z.boolean() })).optional(),
});

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get('projectId');
    const where = projectId ? { projectId } : {};
    const tasks = await prisma.task.findMany({
      where,
      include: {
        assignee: { select: { id: true, fullName: true, email: true, avatarUrl: true, level: true, department: true } },
        subTasks: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json(tasks);
  } catch (error) {
    console.error('GET /api/tasks Error:', error);
    return NextResponse.json({ error: 'Failed to fetch tasks' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const data = CreateTaskSchema.parse(body);
    const task = await prisma.task.create({
      data,
      include: { assignee: { select: { id: true, fullName: true, email: true, avatarUrl: true, level: true } } },
    });
    return NextResponse.json(task, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Validation failed', details: error.errors }, { status: 400 });
    }
    console.error('POST /api/tasks Error:', error);
    return NextResponse.json({ error: 'Failed to create task' }, { status: 500 });
  }
}
