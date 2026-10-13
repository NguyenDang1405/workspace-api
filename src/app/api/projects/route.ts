import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { z } from 'zod';

const CreateProjectSchema = z.object({
  name: z.string().min(2),
  description: z.string().optional(),
  requiredSkills: z.array(z.string()).optional().default([]),
  complexity: z.enum(['EASY', 'MEDIUM', 'HARD']).optional().default('MEDIUM'),
  status: z.enum(['PLANNING', 'IN_PROGRESS', 'COMPLETED']).optional().default('PLANNING'),
  assignedTeamId: z.string().uuid().optional(),
  createdBy: z.string().uuid(),
});

export async function GET() {
  try {
    const projects = await prisma.project.findMany({
      include: {
        assignedTeam: { select: { id: true, name: true } },
        creator: { select: { id: true, fullName: true, email: true } },
        tasks: { select: { id: true, title: true, status: true, priority: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json(projects);
  } catch (error) {
    console.error('GET /api/projects Error:', error);
    return NextResponse.json({ error: 'Failed to fetch projects' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const data = CreateProjectSchema.parse(body);
    const project = await prisma.project.create({ data });
    return NextResponse.json(project, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Validation failed', details: error.errors }, { status: 400 });
    }
    console.error('POST /api/projects Error:', error);
    return NextResponse.json({ error: 'Failed to create project' }, { status: 500 });
  }
}
