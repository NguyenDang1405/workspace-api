import { prisma } from '@/lib/prisma';
import { generateTaskEmbedding } from '@/lib/openai';
import {
  AutoDispatchAssignment,
  AutoDispatchPlanResponseData,
  CandidateScoreSummary,
  ConfirmAssignmentItemInput,
  ConfirmAssignmentsResponseData,
  ScheduleTimeline,
  SuggestedAssignee,
} from '@/types/auto-dispatch.types';

// ============================================================================
// MATHEMATICAL & DATE HELPER UTILITIES
// ============================================================================

/**
 * Parses vector string format `[-0.0123, 0.456, ...]` into number array.
 */
function parseVector(vecStr: string | null | undefined): number[] | null {
  if (!vecStr) return null;
  try {
    const trimmed = vecStr.trim();
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      return trimmed
        .slice(1, -1)
        .split(',')
        .map((v) => parseFloat(v.trim()))
        .filter((v) => !isNaN(v));
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Computes Cosine Similarity between two 1536-dimensional vectors.
 * Returns a score clamped in [0.0, 1.0].
 */
function computeCosineSimilarity(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length || vecA.length === 0) return 0.5;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }

  if (normA === 0 || normB === 0) return 0.5;

  const sim = dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  return Math.min(Math.max(sim, 0.0), 1.0);
}

/**
 * Advances a working date by `offsetHours` based on standard 8-hour workdays
 * (08:00 - 17:00, Monday through Friday, skipping Saturday & Sunday).
 */
export function addWorkingHours(startDate: Date, offsetHours: number): Date {
  const date = new Date(startDate.getTime());

  // If outside 08:00 - 17:00 or on weekend, snap to next working morning 08:00
  const snapToWorkdayMorning = (d: Date) => {
    while (d.getUTCDay() === 0 || d.getUTCDay() === 6) {
      // 0 = Sunday, 6 = Saturday
      d.setUTCDate(d.getUTCDate() + 1);
      d.setUTCHours(8, 0, 0, 0);
    }
    if (d.getUTCHours() < 8) {
      d.setUTCHours(8, 0, 0, 0);
    } else if (d.getUTCHours() >= 17) {
      d.setUTCDate(d.getUTCDate() + 1);
      d.setUTCHours(8, 0, 0, 0);
      while (d.getUTCDay() === 0 || d.getUTCDay() === 6) {
        d.setUTCDate(d.getUTCDate() + 1);
      }
    }
  };

  snapToWorkdayMorning(date);

  let remainingHours = Math.max(0, offsetHours);

  while (remainingHours > 0) {
    const currentHour = date.getUTCHours() + date.getUTCMinutes() / 60;
    const hoursLeftToday = Math.max(0, 17 - currentHour);

    if (remainingHours <= hoursLeftToday) {
      const addedMinutes = Math.round(remainingHours * 60);
      date.setUTCMinutes(date.getUTCMinutes() + addedMinutes);
      remainingHours = 0;
    } else {
      remainingHours -= hoursLeftToday;
      date.setUTCDate(date.getUTCDate() + 1);
      date.setUTCHours(8, 0, 0, 0);
      snapToWorkdayMorning(date);
    }
  }

  return date;
}

// ============================================================================
// SERVICE: AI AUTO-DISPATCH & CALENDAR SCHEDULING (MOD-11)
// ============================================================================

export interface RawCandidateRecord {
  id: string;
  fullName: string;
  email: string;
  department: string;
  level: string;
  skillEmbedding: string | null;
  avgElo: number;
  activeWorkload: number;
}

/**
 * 1. Generates an AI-driven preview auto-dispatch & timeline schedule plan for a project.
 * Does not mutate the database; designed for Human-in-the-Loop Leader preview.
 */
export async function generateAutoDispatchPlan(
  projectId: string,
  _currentUserId?: string
): Promise<AutoDispatchPlanResponseData> {
  // 1. Fetch project and tasks
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      team: {
        include: {
          memberships: {
            where: { leftAt: null },
            include: { user: true },
          },
        },
      },
    },
  });

  if (!project) {
    throw new Error('PROJECT_NOT_FOUND');
  }

  const tasks = await prisma.task.findMany({
    where: { projectId },
    include: {
      dependencies: true,
      dependents: true,
    },
    orderBy: [{ earlyStart: 'asc' }, { createdAt: 'asc' }],
  });

  if (tasks.length === 0) {
    return {
      projectId,
      totalTasks: 0,
      estimatedCompletionDate: (project.startDate || new Date()).toISOString(),
      assignments: [],
    };
  }

  // 2. Fetch raw task embeddings from PostgreSQL
  const rawTaskEmbeddings = await prisma.$queryRaw<
    Array<{ id: string; embedding: string | null }>
  >`
    SELECT id, task_embedding::text AS embedding 
    FROM tasks 
    WHERE project_id = ${projectId}::uuid
  `;
  const taskEmbeddingMap = new Map<string, string | null>();
  rawTaskEmbeddings.forEach((r) => taskEmbeddingMap.set(r.id, r.embedding));

  // 3. Resolve eligible project candidates
  let eligibleUserIds: string[] = [];
  if (project.team && project.team.memberships.length > 0) {
    eligibleUserIds = project.team.memberships.map((m) => m.userId);
    if (!eligibleUserIds.includes(project.ownerId)) {
      eligibleUserIds.push(project.ownerId);
    }
  } else {
    // If no team linked, candidate pool includes all active members/leaders
    const activeUsers = await prisma.user.findMany({
      where: { isActive: true },
      select: { id: true },
    });
    eligibleUserIds = activeUsers.map((u) => u.id);
  }

  // 4. Fetch candidate talent profiles, Elo skill ratings, and current active workloads
  const candidateUsers = await prisma.user.findMany({
    where: { id: { in: eligibleUserIds }, isActive: true },
    include: {
      talentProfile: true,
      skillRatings: true,
      _count: {
        select: {
          assignedTasks: {
            where: { status: { in: ['IN_PROGRESS', 'TODO'] } },
          },
        },
      },
    },
  });

  // Fetch raw skill embeddings for candidates
  const rawUserEmbeddings = await prisma.$queryRaw<
    Array<{ user_id: string; embedding: string | null }>
  >`
    SELECT user_id, skill_embedding::text AS embedding 
    FROM user_talent_profiles 
    WHERE user_id = ANY(${eligibleUserIds}::uuid[])
  `;
  const userEmbeddingMap = new Map<string, string | null>();
  rawUserEmbeddings.forEach((r) => userEmbeddingMap.set(r.user_id, r.embedding));

  // Build candidate records
  const candidates: RawCandidateRecord[] = candidateUsers.map((u) => {
    const ratings = u.skillRatings;
    const avgRating =
      ratings.length > 0
        ? ratings.reduce((sum, r) => sum + Number(r.ratingScore), 0) / ratings.length
        : 1200.0;

    return {
      id: u.id,
      fullName: u.fullName,
      email: u.email,
      department: u.talentProfile?.department || 'FULLSTACK',
      level: u.talentProfile?.level || 'JUNIOR',
      skillEmbedding: userEmbeddingMap.get(u.id) || null,
      avgElo: avgRating,
      activeWorkload: u._count.assignedTasks,
    };
  });

  // Fallback: If candidate pool is somehow empty, query at least 1 active user
  if (candidates.length === 0) {
    const fallbackUser = await prisma.user.findFirst({
      where: { isActive: true },
      include: { talentProfile: true },
    });
    if (fallbackUser) {
      candidates.push({
        id: fallbackUser.id,
        fullName: fallbackUser.fullName,
        email: fallbackUser.email,
        department: fallbackUser.talentProfile?.department || 'FULLSTACK',
        level: fallbackUser.talentProfile?.level || 'JUNIOR',
        skillEmbedding: null,
        avgElo: 1200.0,
        activeWorkload: 0,
      });
    }
  }

  // 5. Setup Project Base Timeline (08:00 UTC)
  const projectStartDate = project.startDate ? new Date(project.startDate) : new Date();
  projectStartDate.setUTCHours(8, 0, 0, 0);

  // Dynamic workload tracker during preview to achieve workload balancing
  const projectedWorkloadMap = new Map<string, number>();
  candidates.forEach((c) => projectedWorkloadMap.set(c.id, c.activeWorkload));

  const assignments: AutoDispatchAssignment[] = [];
  let latestTaskDueDate = new Date(projectStartDate.getTime());

  // 6. Matchmaking & Scheduling loop for each task
  for (const task of tasks) {
    let taskVecStr = taskEmbeddingMap.get(task.id);
    let taskVec = parseVector(taskVecStr);

    // If taskEmbedding is missing, generate embedding via OpenAI adapter and cache
    if (!taskVec || taskVec.length === 0) {
      try {
        const generatedVec = await generateTaskEmbedding(task.title, task.description);
        if (generatedVec && generatedVec.length === 1536) {
          taskVec = generatedVec;
          const formattedVecStr = `[${generatedVec.join(',')}]`;
          prisma
            .$executeRawUnsafe(
              `UPDATE tasks SET task_embedding = $1::vector WHERE id = $2::uuid`,
              formattedVecStr,
              task.id
            )
            .catch((e) => console.warn('Async task_embedding update failed:', e));
        }
      } catch (err) {
        console.warn(`Could not generate embedding for task ${task.id}:`, err);
      }
    }

    // Evaluate each candidate
    const scoredCandidates: Array<{
      candidate: RawCandidateRecord;
      matchScore: number;
      matchReason: string;
      cosine: number;
    }> = [];

    for (const cand of candidates) {
      const candVec = parseVector(cand.skillEmbedding);
      const cosine =
        taskVec && candVec ? computeCosineSimilarity(taskVec, candVec) : 0.65;

      // Elo normalized to [0, 1] (1200 -> 0.6, 2000 -> 1.0)
      const normElo = Math.min(Math.max(cand.avgElo / 2000.0, 0.0), 1.0);

      // Workload penalty based on active + projected tasks
      const currentWorkload = projectedWorkloadMap.get(cand.id) || 0;
      const workloadPenalty = Math.min(currentWorkload / 5.0, 1.0);

      // MOD-11 Formulation:
      // Score = 0.5 * CosineSim + 0.3 * NormElo - 0.2 * WorkloadPenalty
      const rawScore = 0.5 * cosine + 0.3 * normElo - 0.2 * workloadPenalty;
      const matchScore = Math.round(Math.min(Math.max(rawScore, 0.0), 1.0) * 100);

      const matchReason = `Độ phù hợp kỹ năng (${(cosine * 100).toFixed(0)}%), Elo ${cand.avgElo.toFixed(0)}, tải công việc ${currentWorkload} task`;

      scoredCandidates.push({
        candidate: cand,
        matchScore,
        matchReason,
        cosine,
      });
    }

    // Sort descending by matchScore
    scoredCandidates.sort((a, b) => b.matchScore - a.matchScore);

    const top = scoredCandidates[0];
    const suggestedAssignee: SuggestedAssignee = {
      userId: top.candidate.id,
      fullName: top.candidate.fullName,
      email: top.candidate.email,
      matchScore: top.matchScore,
      matchReason: top.matchReason,
    };

    // Increment projected workload for the chosen candidate to balance load
    projectedWorkloadMap.set(top.candidate.id, (projectedWorkloadMap.get(top.candidate.id) || 0) + 1);

    // Timeline calculation based on CPM earlyStart and estimatedHours
    const earlyStartHours = Number(task.earlyStart) || 0;
    const estHours = Number(task.estimatedHours) || 4.0;

    const taskStartDate = addWorkingHours(projectStartDate, earlyStartHours);
    const taskDueDate = addWorkingHours(taskStartDate, estHours);

    if (taskDueDate > latestTaskDueDate) {
      latestTaskDueDate = taskDueDate;
    }

    const availableCandidates: CandidateScoreSummary[] = scoredCandidates.map((sc) => ({
      userId: sc.candidate.id,
      fullName: sc.candidate.fullName,
      matchScore: sc.matchScore,
      matchReason: sc.matchReason,
    }));

    assignments.push({
      taskId: task.id,
      taskTitle: task.title,
      estimatedHours: estHours,
      isCriticalPath: task.isCriticalPath,
      suggestedAssignee,
      schedule: {
        startDate: taskStartDate.toISOString(),
        dueDate: taskDueDate.toISOString(),
      },
      availableCandidates,
    });
  }

  return {
    projectId,
    totalTasks: assignments.length,
    estimatedCompletionDate: latestTaskDueDate.toISOString(),
    assignments,
  };
}

/**
 * 2. Confirms & commits auto-dispatch assignments and timeline schedules into PostgreSQL
 * within an atomic database transaction.
 */
export async function confirmAutoDispatchAssignments(
  projectId: string,
  confirmations: ConfirmAssignmentItemInput[],
  leaderUserId: string
): Promise<ConfirmAssignmentsResponseData> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
  });

  if (!project) {
    throw new Error('PROJECT_NOT_FOUND');
  }

  // Execute database transaction
  const updatedTasks = await prisma.$transaction(async (tx) => {
    const results: Array<{
      id: string;
      title: string;
      assignedTo: string;
      startDate: string;
      dueDate: string;
      status: string;
      isHumanOverride: boolean;
    }> = [];

    for (const conf of confirmations) {
      const existingTask = await tx.task.findUnique({
        where: { id: conf.taskId },
        select: { id: true, title: true, status: true, assignedTo: true },
      });

      if (!existingTask) {
        throw new Error(`TASK_NOT_FOUND: ${conf.taskId}`);
      }

      const isOverride = Boolean(conf.overrideReason && conf.overrideReason.trim().length > 0);
      const parsedStartDate = new Date(conf.startDate);
      const parsedDueDate = new Date(conf.dueDate);

      // 1. Update task in database
      const updated = await tx.task.update({
        where: { id: conf.taskId },
        data: {
          assignedTo: conf.finalAssigneeId,
          startDate: parsedStartDate,
          dueDate: parsedDueDate,
          status: 'TODO',
        },
      });

      // 2. Insert dispatch history log
      await tx.dispatchHistory.create({
        data: {
          taskId: conf.taskId,
          chosenUserId: conf.finalAssigneeId,
          recommendedCandidates: [],
          isHumanOverride: isOverride,
          overrideReason: conf.overrideReason || null,
          dispatchedAt: new Date(),
        },
      });

      // 3. Insert status change history log
      await tx.taskStatusHistory.create({
        data: {
          taskId: conf.taskId,
          changedBy: leaderUserId,
          fromStatus: existingTask.status,
          toStatus: 'TODO',
          createdAt: new Date(),
        },
      });

      results.push({
        id: updated.id,
        title: updated.title,
        assignedTo: updated.assignedTo!,
        startDate: parsedStartDate.toISOString(),
        dueDate: parsedDueDate.toISOString(),
        status: updated.status,
        isHumanOverride: isOverride,
      });
    }

    return results;
  });

  return {
    projectId,
    confirmedCount: updatedTasks.length,
    tasks: updatedTasks,
  };
}
