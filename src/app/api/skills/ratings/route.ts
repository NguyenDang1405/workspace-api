import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { z } from 'zod';

const DIFFICULTY_RATINGS: Record<string, number> = {
  EASY: 1000,
  MEDIUM: 1200,
  HARD: 1400,
};

const UpdateRatingSchema = z.object({
  userId: z.string().uuid(),
  skillName: z.string().min(1).max(50),
  outcome: z.enum(['COMPLETED', 'REJECTED']),
  difficulty: z.enum(['EASY', 'MEDIUM', 'HARD']).optional().default('MEDIUM'),
});

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');

    const ratings = await prisma.userSkillRating.findMany({
      where: userId ? { userId } : {},
      include: {
        user: {
          select: {
            id: true,
            fullName: true,
            email: true,
            talentProfile: {
              select: {
                department: true,
                level: true,
              },
            },
          },
        },
      },
      orderBy: { ratingScore: 'desc' },
    });

    return NextResponse.json(ratings);
  } catch (error) {
    console.error('GET /api/skills/ratings Error:', error);
    return NextResponse.json({ error: 'Failed to fetch skill ratings' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { userId, skillName, outcome, difficulty } = UpdateRatingSchema.parse(body);

    const existingRating = await prisma.userSkillRating.findUnique({
      where: {
        userId_skillName: {
          userId,
          skillName,
        },
      },
    });

    const currentScore = existingRating ? Number(existingRating.ratingScore) : 1200.0;
    const taskRating = DIFFICULTY_RATINGS[difficulty];

    // Standard Elo formula: E = 1 / (1 + 10^((R_task - R_user) / 400))
    const expectedScore = 1 / (1 + Math.pow(10, (taskRating - currentScore) / 400));
    const actualScore = outcome === 'COMPLETED' ? 1 : 0;
    const kFactor = 32;

    const newScore = Math.max(100, Math.round((currentScore + kFactor * (actualScore - expectedScore)) * 100) / 100);

    const updated = await prisma.userSkillRating.upsert({
      where: {
        userId_skillName: {
          userId,
          skillName,
        },
      },
      create: {
        userId,
        skillName,
        ratingScore: newScore,
        tasksCompleted: outcome === 'COMPLETED' ? 1 : 0,
        tasksRejected: outcome === 'REJECTED' ? 1 : 0,
      },
      update: {
        ratingScore: newScore,
        tasksCompleted: { increment: outcome === 'COMPLETED' ? 1 : 0 },
        tasksRejected: { increment: outcome === 'REJECTED' ? 1 : 0 },
      },
    });

    return NextResponse.json(updated);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Validation failed', details: error.errors }, { status: 400 });
    }
    console.error('POST /api/skills/ratings Error:', error);
    return NextResponse.json({ error: 'Failed to update skill rating' }, { status: 500 });
  }
}
