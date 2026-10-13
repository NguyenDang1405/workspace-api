import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { z } from 'zod';

const CreateTeamSchema = z.object({
  name: z.string().min(2),
  description: z.string().optional(),
  leaderId: z.string().uuid().optional(),
});

export async function GET() {
  try {
    const teams = await prisma.team.findMany({
      include: {
        leader: { select: { id: true, fullName: true, email: true, avatarUrl: true } },
        members: { select: { id: true, fullName: true, email: true, avatarUrl: true, role: true, department: true, level: true } },
        projects: { select: { id: true, name: true, status: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json(teams);
  } catch (error) {
    console.error('GET /api/teams Error:', error);
    return NextResponse.json({ error: 'Failed to fetch teams' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const data = CreateTeamSchema.parse(body);
    const team = await prisma.team.create({ data });
    return NextResponse.json(team, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Validation failed', details: error.errors }, { status: 400 });
    }
    console.error('POST /api/teams Error:', error);
    return NextResponse.json({ error: 'Failed to create team' }, { status: 500 });
  }
}
