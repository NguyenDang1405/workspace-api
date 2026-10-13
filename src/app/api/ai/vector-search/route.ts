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
        SELECT id, email, "fullName", role, department, level, skills, "bioSummary",
          1 - ("skillEmbedding" <=> ${vectorString}::vector) AS similarity
        FROM "User" WHERE "skillEmbedding" IS NOT NULL
        ORDER BY similarity DESC LIMIT ${limit};
      `;
      return NextResponse.json({ results: users });
    } catch {
      const fallbackUsers = await prisma.user.findMany({
        where: { OR: [{ fullName: { contains: query, mode: 'insensitive' } }, { bioSummary: { contains: query, mode: 'insensitive' } }, { skills: { hasSome: [query] } }] },
        take: limit,
        select: { id: true, email: true, fullName: true, role: true, department: true, level: true, skills: true, bioSummary: true },
      });
      return NextResponse.json({ results: fallbackUsers.map((u) => ({ ...u, similarity: 0.85 })), notice: 'Using standard fallback search' });
    }
  } catch (error) {
    console.error('POST /api/ai/vector-search Error:', error);
    return NextResponse.json({ error: 'Failed to execute vector search' }, { status: 500 });
  }
}
