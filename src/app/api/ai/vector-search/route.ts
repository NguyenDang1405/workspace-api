import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { openai } from '@/lib/openai';

export async function POST(request: Request) {
  try {
    const { query, limit = 5 } = await request.json();
    if (!query) return NextResponse.json({ error: 'Search query is required' }, { status: 400 });

    try {
      const embeddingResponse = await openai.embeddings.create({ model: 'text-embedding-3-small', input: query });
      const vector = embeddingResponse.data[0].embedding;
      const vectorString = `[${vector.join(',')}]`;
      const users: unknown[] = await prisma.$queryRaw`
        SELECT u.id, u.email, u.full_name AS "fullName", u.role,
               p.department, p.level, p.skills, p.bio_summary AS "bioSummary",
               1 - (p.skill_embedding <=> ${vectorString}::vector) AS similarity
        FROM users u
        JOIN user_talent_profiles p ON p.user_id = u.id
        WHERE p.skill_embedding IS NOT NULL AND u.is_active = true
        ORDER BY similarity DESC LIMIT ${limit};
      `;
      return NextResponse.json({ results: users });
    } catch {
      const fallbackUsers = await prisma.user.findMany({
        where: {
          isActive: true,
          OR: [
            { fullName: { contains: query, mode: 'insensitive' } },
            { talentProfile: { bioSummary: { contains: query, mode: 'insensitive' } } },
            { talentProfile: { skills: { hasSome: [query] } } },
          ],
        },
        take: limit,
        include: { talentProfile: true },
      });

      const formatted = fallbackUsers.map((u) => ({
        id: u.id,
        email: u.email,
        fullName: u.fullName,
        role: u.role,
        department: u.talentProfile?.department || 'FULLSTACK',
        level: u.talentProfile?.level || 'JUNIOR',
        skills: u.talentProfile?.skills || [],
        bioSummary: u.talentProfile?.bioSummary || null,
        similarity: 0.85,
      }));

      return NextResponse.json({ results: formatted, notice: 'Using standard fallback search' });
    }
  } catch (error) {
    console.error('POST /api/ai/vector-search Error:', error);
    return NextResponse.json({ error: 'Failed to execute vector search' }, { status: 500 });
  }
}
