import OpenAI from 'openai';

export const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || '',
});

/**
 * Generate a 1536-dimensional embedding for the given text using OpenAI's
 * `text-embedding-3-small` model.
 * Returns a number array. On failure, returns a zero-filled vector.
 */
export async function embedText(text: string): Promise<number[]> {
  try {
    const response = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: text,
    });
    return response.data[0].embedding;
  } catch (error) {
    console.error('OpenAI embedding error:', error);
    return new Array(1536).fill(0);
  }
}

/**
 * Generate a 1536-dimensional embedding specifically for talent profiles.
 * Formats context string: "Phòng ban: ... | Cấp bậc: ... | Kỹ năng: ... | Kinh nghiệm: ..."
 * Returns number[] on success, or null on error/timeout so callers can keep is_embedding_stale = true.
 */
export async function generateProfileEmbedding(data: {
  department: string;
  level: string;
  skills: string[];
  bioSummary?: string | null;
}): Promise<number[] | null> {
  const context = `Phòng ban: ${data.department} | Cấp bậc: ${data.level} | Kỹ năng: ${data.skills.join(', ')} | Kinh nghiệm: ${data.bioSummary || ''}`;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await openai.embeddings.create(
      {
        model: 'text-embedding-3-small',
        input: context,
      },
      { signal: controller.signal }
    );
    clearTimeout(timeoutId);

    return response.data[0]?.embedding ?? null;
  } catch (error) {
    console.error('Error generating profile embedding:', error);
    return null;
  }
}

/**
 * Generate a 1536-dimensional embedding specifically for tasks (MOD-02 / MOD-03).
 * Uses context: `${title} ${description}`.
 * Returns number[] on success, or null on error/timeout.
 */
export async function generateTaskEmbedding(
  title: string,
  description?: string | null
): Promise<number[] | null> {
  const context = `${title} ${description || ''}`.trim();
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await openai.embeddings.create(
      {
        model: 'text-embedding-3-small',
        input: context,
      },
      { signal: controller.signal }
    );
    clearTimeout(timeoutId);

    return response.data[0]?.embedding ?? null;
  } catch (error) {
    console.error('Error generating task embedding:', error);
    return null;
  }
}
