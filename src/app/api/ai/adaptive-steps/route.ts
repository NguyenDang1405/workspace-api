import { NextResponse } from 'next/server';
import { openai } from '@/lib/openai';

export async function POST(request: Request) {
  try {
    const { taskTitle, level = 'INTERN' } = await request.json();
    if (!taskTitle) return NextResponse.json({ error: 'taskTitle is required' }, { status: 400 });

    const prompt = `Generate a step-by-step checklist for a developer at level "${level}" to complete:
Task: ${taskTitle}
For INTERN/FRESHER: highly detailed micro-steps. For SENIOR/MIDDLE: milestone items.
Return JSON: {"checklist": [{"id": "step-1", "text": "...", "done": false}]}`;

    try {
      const completion = await openai.chat.completions.create({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: prompt }], response_format: { type: 'json_object' } });
      return NextResponse.json(JSON.parse(completion.choices[0].message.content || '{}'));
    } catch {
      const steps = (level === 'INTERN' || level === 'FRESHER') ? [
        { id: 'step-1', text: `Read documentation for ${taskTitle}`, done: false },
        { id: 'step-2', text: 'Create git feature branch', done: false },
        { id: 'step-3', text: 'Implement baseline logic', done: false },
        { id: 'step-4', text: 'Test manually in local dev environment', done: false },
        { id: 'step-5', text: 'Submit Pull Request for team review', done: false },
      ] : [
        { id: 'step-1', text: `Design architecture for ${taskTitle}`, done: false },
        { id: 'step-2', text: 'Implement with exception handling', done: false },
        { id: 'step-3', text: 'Verify performance and security', done: false },
      ];
      return NextResponse.json({ checklist: steps });
    }
  } catch (error) {
    console.error('POST /api/ai/adaptive-steps Error:', error);
    return NextResponse.json({ error: 'Failed to generate adaptive checklist' }, { status: 500 });
  }
}
