import { prisma } from '@/lib/prisma';
import { generateProfileEmbedding } from '@/lib/openai';
import { RankedCandidateDto } from '@/types/retrieval.types';

/**
 * Helper to construct an OR-joined search string for websearch_to_tsquery.
 * Extracts technical and meaningful alphanumeric tokens from task title & description.
 * In websearch_to_tsquery('simple', 'term1 or term2'), 'or' is parsed as boolean '|',
 * ensuring candidates matching ANY relevant skill term are recalled and ranked by BM25.
 */
function buildSparseQueryString(title: string, description?: string | null): string {
  const combined = `${title} ${description || ''}`;
  // Extract alphanumeric words with length >= 2
  const words = Array.from(
    new Set(
      combined
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .split(/\s+/)
        .filter((w) => w.length >= 2)
    )
  );

  if (words.length === 0) {
    return title.trim() || 'developer';
  }

  // Join top 15 terms with ' or ' for websearch_to_tsquery
  return words.slice(0, 15).join(' or ');
}

interface RawQueryResult {
  userId: string;
  fullName: string;
  email: string;
  department: string;
  level: string;
  skills: string[] | null;
  sparseRank: number | bigint | null;
  denseRank: number | bigint | null;
  rrfScore: number | string;
  activeWorkload: number | bigint;
}

interface TaskRecord {
  id: string;
  title: string;
  description: string | null;
  targetDepartment: string;
  requiredLevel: string;
  taskEmbedding: string | null;
}

/**
 * MOD-03: Hybrid Retrieval Engine
 * Executes Reciprocal Rank Fusion (RRF, k = 60) combining BM25 Full-Text Search
 * (search_vector with GIN index) and Cosine Vector Similarity (skill_embedding with HNSW)
 * within PostgreSQL 16.
 *
 * Utilizes pre-computed `tasks.task_embedding` if present (from MOD-02 decomposition)
 * to achieve sub-30ms execution times without calling external embedding APIs at runtime.
 *
 * Enforces prerequisites:
 * 1. is_active = true
 * 2. department == task.target_department (or cross-dept if allowCrossDept = true)
 * 3. level >= task.required_level (Intern: 1, Fresher: 2, Junior: 3, Middle: 4, Senior: 5)
 * 4. skill_embedding IS NOT NULL AND embedding_revision == profile_revision
 */
export async function searchCandidatesForTask(
  taskId: string,
  limit: number = 10,
  allowCrossDept: boolean = false
): Promise<RankedCandidateDto[]> {
  // 1. Fetch task metadata and pre-computed task_embedding
  const tasks = await prisma.$queryRaw<TaskRecord[]>`
    SELECT 
      id, 
      title, 
      description, 
      target_department AS "targetDepartment", 
      required_level AS "requiredLevel", 
      task_embedding::text AS "taskEmbedding"
    FROM tasks
    WHERE id = ${taskId}::uuid
    LIMIT 1;
  `;

  const task = tasks[0];
  if (!task) {
    throw new Error('TASK_NOT_FOUND');
  }

  // 2. Retrieve dense query vector: use persisted task_embedding if available,
  // else generate on-the-fly via OpenAI and persist for subsequent requests
  let vectorString = task.taskEmbedding;
  if (!vectorString) {
    const queryContext = `${task.title} ${task.description || ''}`.trim();
    const queryEmbedding = await generateProfileEmbedding({
      department: task.targetDepartment,
      level: task.requiredLevel,
      skills: [],
      bioSummary: queryContext,
    });

    if (!queryEmbedding || queryEmbedding.length === 0) {
      throw new Error('EMBEDDING_GENERATION_FAILED');
    }

    vectorString = `[${queryEmbedding.join(',')}]`;

    // Persist to database asynchronously to optimize future queries
    prisma
      .$executeRawUnsafe(
        `UPDATE tasks SET task_embedding = $1::vector WHERE id = $2::uuid`,
        vectorString,
        task.id
      )
      .catch((err) => console.warn('Failed to cache task_embedding:', err));
  }

  const sparseQuery = buildSparseQueryString(task.title, task.description);

  // 3. Execute High-Performance SQL CTE with RRF (k = 60)
  const results = await prisma.$queryRaw<RawQueryResult[]>`
    WITH task_meta AS (
      SELECT 
        ${task.targetDepartment}::varchar AS target_dept,
        ${task.requiredLevel}::varchar AS req_level,
        websearch_to_tsquery('simple', ${sparseQuery}) AS ts_query
    ),
    level_weights AS (
      SELECT * FROM (VALUES 
        ('INTERN', 1), ('FRESHER', 2), ('JUNIOR', 3), ('MIDDLE', 4), ('SENIOR', 5)
      ) AS t(lvl, weight)
    ),
    eligible_users AS (
      SELECT 
        u.id AS user_id,
        u.full_name,
        u.email,
        p.department,
        p.level,
        p.skills,
        p.skill_embedding,
        p.search_vector
      FROM users u
      JOIN user_talent_profiles p ON u.id = p.user_id
      JOIN task_meta tm ON true
      JOIN level_weights lw_user ON lw_user.lvl = p.level::text
      JOIN level_weights lw_req ON lw_req.lvl = tm.req_level
      WHERE u.is_active = true
        AND (${allowCrossDept} = true OR p.department::text = tm.target_dept)
        AND lw_user.weight >= lw_req.weight
        AND p.skill_embedding IS NOT NULL
        AND p.embedding_revision = p.profile_revision
    ),
    sparse_search AS (
      SELECT 
        eu.user_id,
        ROW_NUMBER() OVER (
          ORDER BY ts_rank_cd(eu.search_vector, tm.ts_query) DESC, eu.user_id
        ) AS rank_sparse
      FROM eligible_users eu
      CROSS JOIN task_meta tm
      WHERE tm.ts_query != ''::tsquery AND eu.search_vector @@ tm.ts_query
      LIMIT 50
    ),
    dense_search AS (
      SELECT 
        eu.user_id,
        ROW_NUMBER() OVER (
          ORDER BY (eu.skill_embedding <=> ${vectorString}::vector) ASC, eu.user_id
        ) AS rank_dense
      FROM eligible_users eu
      LIMIT 50
    ),
    rrf_merge AS (
      SELECT 
        COALESCE(s.user_id, d.user_id) AS user_id,
        COALESCE(1.0 / (60.0 + s.rank_sparse), 0.0) +
        COALESCE(1.0 / (60.0 + d.rank_dense), 0.0) AS rrf_score,
        s.rank_sparse,
        d.rank_dense
      FROM sparse_search s
      FULL OUTER JOIN dense_search d ON s.user_id = d.user_id
    ),
    active_workloads AS (
      SELECT 
        t.assigned_to AS user_id,
        COUNT(t.id)::int AS workload_count
      FROM tasks t
      WHERE t.status = 'IN_PROGRESS' AND t.assigned_to IS NOT NULL
      GROUP BY t.assigned_to
    )
    SELECT 
      u.id AS "userId",
      u.full_name AS "fullName",
      u.email,
      p.department::text AS "department",
      p.level::text AS "level",
      p.skills,
      rm.rank_sparse AS "sparseRank",
      rm.rank_dense AS "denseRank",
      ROUND(rm.rrf_score::numeric, 6)::float AS "rrfScore",
      COALESCE(aw.workload_count, 0)::int AS "activeWorkload"
    FROM rrf_merge rm
    JOIN users u ON u.id = rm.user_id
    JOIN user_talent_profiles p ON p.user_id = rm.user_id
    LEFT JOIN active_workloads aw ON aw.user_id = rm.user_id
    ORDER BY rm.rrf_score DESC, "activeWorkload" ASC, u.id ASC
    LIMIT ${limit};
  `;

  // 4. Safely normalize BigInt/Numeric fields for API consumption
  return results.map((r) => ({
    userId: String(r.userId),
    fullName: String(r.fullName),
    email: String(r.email),
    department: String(r.department),
    level: String(r.level),
    skills: Array.isArray(r.skills) ? r.skills : [],
    sparseRank: r.sparseRank != null ? Number(r.sparseRank) : null,
    denseRank: r.denseRank != null ? Number(r.denseRank) : null,
    rrfScore: Number(r.rrfScore),
    activeWorkload: Number(r.activeWorkload),
  }));
}
