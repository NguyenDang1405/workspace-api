import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        fullName: true,
        avatarUrl: true,
        role: true,
        isActive: true,
        talentProfile: {
          select: {
            department: true,
            level: true,
            skills: true,
            bioSummary: true,
          },
        },
        teamMemberships: {
          where: { leftAt: null },
          select: {
            team: { select: { id: true, name: true } },
          },
        },
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    const flattened = users.map((u) => ({
      id: u.id,
      email: u.email,
      fullName: u.fullName,
      avatarUrl: u.avatarUrl,
      role: u.role,
      isActive: u.isActive,
      department: u.talentProfile?.department || 'FULLSTACK',
      level: u.talentProfile?.level || 'JUNIOR',
      skills: u.talentProfile?.skills || [],
      bioSummary: u.talentProfile?.bioSummary || null,
      team: u.teamMemberships[0]?.team || null,
      createdAt: u.createdAt,
    }));

    return NextResponse.json(flattened);
  } catch (error) {
    console.error('GET /api/users Error:', error);
    return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 });
  }
}
