import { NextResponse } from 'next/server';
import { openai } from '@/lib/openai';

export async function POST(request: Request) {
  try {
    const { title, description } = await request.json();
    if (!title) return NextResponse.json({ error: 'Task title is required' }, { status: 400 });

    const prompt = `Decompose this task into 3-5 actionable sub-tasks:
Task: ${title}
Description: ${description || 'N/A'}
Return JSON: {"subtasks": [{"title": "...", "description": "...", "priority": "HIGH", "requiredLevel": "JUNIOR"}]}`;

    try {
      const completion = await openai.chat.completions.create({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: prompt }], response_format: { type: 'json_object' } });
      return NextResponse.json(JSON.parse(completion.choices[0].message.content || '{}'));
    } catch {
      return NextResponse.json({ subtasks: [
        { title: `Setup environment for ${title}`, description: 'Prepare config and dependencies', priority: 'HIGH', requiredLevel: 'JUNIOR' },
        { title: `Implement core logic for ${title}`, description: 'Write implementation and handle edge cases', priority: 'HIGH', requiredLevel: 'MIDDLE' },
        { title: `Write tests & document ${title}`, description: 'Ensure test coverage and update docs', priority: 'MEDIUM', requiredLevel: 'INTERN' },
      ]});
    }
  } catch (error) {
    console.error('POST /api/ai/breakdown-task Error:', error);
    return NextResponse.json({ error: 'Failed to break down task' }, { status: 500 });
  }
}
