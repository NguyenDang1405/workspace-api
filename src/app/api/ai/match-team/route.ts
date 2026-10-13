import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { openai } from '@/lib/openai';

export async function POST(request: Request) {
  try {
    const { projectId } = await request.json();
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

    const teams = await prisma.team.findMany({
      include: { members: { select: { fullName: true, skills: true, level: true, department: true } } },
    });

    const prompt = `Analyze this project requirement:
Project Name: ${project.name}
Required Skills: ${project.requiredSkills.join(', ')}
Complexity: ${project.complexity}

Available Teams:
${teams.map((t) => `Team ID: ${t.id}, Name: ${t.name}, Skills: ${t.members.flatMap((m) => m.skills).join(', ')}`).join('\n')}

Recommend the top 2 best-fit teams with match scores (0-100%) in JSON:
{"recommendations": [{"teamId": "...", "teamName": "...", "score": 95, "reason": "..."}]}`;

    try {
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
      });
      const result = JSON.parse(completion.choices[0].message.content || '{}');
      return NextResponse.json(result);
    } catch {
      const heuristicMatches = teams.map((team) => {
        const teamSkills = new Set(team.members.flatMap((m) => m.skills));
        const matched = project.requiredSkills.filter((s) => teamSkills.has(s));
        const score = Math.round((matched.length / (project.requiredSkills.length || 1)) * 100);
        return { teamId: team.id, teamName: team.name, score: Math.max(score, 70), reason: `${matched.length}/${project.requiredSkills.length} skills matched` };
      });
      return NextResponse.json({ recommendations: heuristicMatches });
    }
  } catch (error) {
    console.error('POST /api/ai/match-team Error:', error);
    return NextResponse.json({ error: 'Failed to process team matching' }, { status: 500 });
  }
}
