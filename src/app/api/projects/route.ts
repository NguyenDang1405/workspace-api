import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { z } from 'zod';

const CreateProjectSchema = z.object({
  name: z.string().min(2),
  description: z.string().default(''),
  techStack: z.array(z.string()).optional(),
  requiredSkills: z.array(z.string()).optional(),
  complexity: z.enum(['EASY', 'MEDIUM', 'HARD']).optional().default('MEDIUM'),
  status: z.enum(['PLANNING', 'ACTIVE', 'COMPLETED', 'ARCHIVED']).optional().default('PLANNING'),
  teamId: z.string().uuid().optional(),
  assignedTeamId: z.string().uuid().optional(),
  ownerId: z.string().uuid().optional(),
  createdBy: z.string().uuid().optional(),
  startDate: z.string().datetime().optional(),
  targetEndDate: z.string().datetime().optional(),
});

export async function GET() {
  try {
    const projects = await prisma.project.findMany({
      include: {
        team: { select: { id: true, name: true } },
        owner: { select: { id: true, fullName: true, email: true } },
        tasks: { select: { id: true, title: true, status: true, priority: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const formatted = projects.map((p) => ({
      ...p,
      assignedTeamId: p.teamId,
      assignedTeam: p.team,
      createdBy: p.ownerId,
      creator: p.owner,
      requiredSkills: p.techStack,
    }));

    return NextResponse.json(formatted);
  } catch (error) {
    console.error('GET /api/projects Error:', error);
    return NextResponse.json({ error: 'Failed to fetch projects' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = CreateProjectSchema.parse(body);

    const teamId = parsed.teamId || parsed.assignedTeamId;
    const ownerId = parsed.ownerId || parsed.createdBy;
    const techStack = parsed.techStack || parsed.requiredSkills || [];

    if (!teamId || !ownerId) {
      return NextResponse.json({ error: 'teamId and ownerId are required' }, { status: 400 });
    }

    const project = await prisma.project.create({
      data: {
        name: parsed.name,
        description: parsed.description,
        techStack,
        complexity: parsed.complexity,
        status: parsed.status,
        teamId,
        ownerId,
        startDate: parsed.startDate ? new Date(parsed.startDate) : new Date(),
        targetEndDate: parsed.targetEndDate ? new Date(parsed.targetEndDate) : new Date(Date.now() + 30 * 24 * 3600 * 1000),
      },
      include: {
        team: { select: { id: true, name: true } },
        owner: { select: { id: true, fullName: true, email: true } },
      },
    });

    return NextResponse.json(project, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Validation failed', details: error.errors }, { status: 400 });
    }
    console.error('POST /api/projects Error:', error);
    return NextResponse.json({ error: 'Failed to create project' }, { status: 500 });
  }
}
