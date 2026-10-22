import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { EloCalculationResult } from '@/types/elo.types';

// ==========================================
// 1. CONSTANTS & DIFFICULTY MAPPINGS
// ==========================================
export const LEVEL_DIFFICULTY_MAP: Record<string, number> = {
  INTERN: 1000.0,
  FRESHER: 1200.0,
  JUNIOR: 1400.0,
  MIDDLE: 1600.0,
  SENIOR: 1800.0,
};

export const BASE_K_FACTOR = 32.0;
export const MIN_ELO_RATING = 800.0;
export const MAX_ELO_RATING = 2400.0;
export const DEFAULT_INITIAL_ELO = 1200.0;

// ==========================================
// 2. PURE ELO MATHEMATICS FUNCTIONS
// ==========================================
/**
 * Calculates expected score E_u in range (0, 1) based on Logistic Curve:
 * E_u = 1 / (1 + 10^((R_v - R_u) / 400))
 */
export function calculateExpectedScore(userRating: number, taskDifficulty: number): number {
  return 1.0 / (1.0 + Math.pow(10, (taskDifficulty - userRating) / 400.0));
}

/**
 * Calculates dynamic K-factor based on experience uncertainty and critical path:
 * K = K_base * mu_uncertainty * mu_critical
 */
export function calculateKFactor(tasksCompleted: number, isCriticalPath: boolean): number {
  let muUncertainty = 1.0;
  if (tasksCompleted < 5) {
    muUncertainty = 1.5; // Rapid calibration phase
  } else if (tasksCompleted > 20) {
    muUncertainty = 0.8; // Mature convergence phase
  }

  const muCritical = isCriticalPath ? 1.25 : 1.0;
  return Number((BASE_K_FACTOR * muUncertainty * muCritical).toFixed(2));
}

/**
 * Calculates actual performance score S_u in [0, 1]:
 * - Reject -> 0.0
 * - Approve with actual/estimated <= 1.0 -> 1.0
 * - Approve with 1.0 < actual/estimated <= 1.5 -> 0.75
 * - Approve with actual/estimated > 1.5 -> 0.50
 */
export function calculateActualScore(
  action: 'APPROVE' | 'REJECT',
  estimatedHours: number,
  actualHours: number | null
): number {
  if (action === 'REJECT') {
    return 0.0;
  }

  const est = estimatedHours > 0 ? estimatedHours : 4.0;
  const act = actualHours !== null && actualHours !== undefined && actualHours > 0 ? actualHours : est;
  const ratio = act / est;

  if (ratio <= 1.0) {
    return 1.0;
  }
  if (ratio <= 1.5) {
    return 0.75;
  }
  return 0.5;
}

/**
 * Retrieves task difficulty rating R_v according to required seniority level
 */
export function getTaskDifficulty(level: string): number {
  return LEVEL_DIFFICULTY_MAP[level] || 1200.0;
}

// ==========================================
// 3. ELO CALIBRATION ENGINE (TRANSACTIONAL)
// ==========================================
/**
 * Evaluates developer performance upon task review (APPROVE or REJECT),
 * recalibrates their skill Elo rating, updates time-series logs,
 * and sets the talent profile's embedding to stale.
 */
export async function processTaskEloCalibration(
  taskId: string,
  action: 'APPROVE' | 'REJECT',
  primarySkill: string = 'General',
  externalTx?: Prisma.TransactionClient
): Promise<EloCalculationResult> {
  const dbClient = externalTx || prisma;

  // 1. Fetch Task Details
  const task = await dbClient.task.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      title: true,
      assignedTo: true,
      requiredLevel: true,
      estimatedHours: true,
      actualHours: true,
      isCriticalPath: true,
    },
  });

  if (!task) {
    throw new Error('TASK_NOT_FOUND');
  }
  if (!task.assignedTo) {
    throw new Error('TASK_HAS_NO_ASSIGNEE');
  }

  const userId = task.assignedTo;
  const taskDifficulty = getTaskDifficulty(task.requiredLevel);

  // 2. Fetch or initialize current user skill rating
  let currentSkill = await dbClient.userSkillRating.findUnique({
    where: {
      userId_skillName: { userId, skillName: primarySkill },
    },
  });

  if (!currentSkill) {
    currentSkill = await dbClient.userSkillRating.create({
      data: {
        userId,
        skillName: primarySkill,
        ratingScore: new Prisma.Decimal(DEFAULT_INITIAL_ELO),
        tasksCompleted: 0,
        tasksRejected: 0,
      },
    });
  }

  const oldRating = Number(currentSkill.ratingScore);

  // 3. Mathematical Calculations
  const expectedScore = calculateExpectedScore(oldRating, taskDifficulty);
  const actualScore = calculateActualScore(
    action,
    Number(task.estimatedHours),
    task.actualHours ? Number(task.actualHours) : null
  );

  const kFactor = calculateKFactor(currentSkill.tasksCompleted, task.isCriticalPath);
  const delta = Number((kFactor * (actualScore - expectedScore)).toFixed(2));
  const newRating = Number(
    Math.max(MIN_ELO_RATING, Math.min(MAX_ELO_RATING, oldRating + delta)).toFixed(2)
  );
  const eventType: 'TASK_DONE' | 'REVIEW_REJECT' =
    action === 'REJECT' ? 'REVIEW_REJECT' : 'TASK_DONE';

  // 4. Persistence within Transaction
  const executeUpdates = async (tx: Prisma.TransactionClient) => {
    // 4.1 Update current user skill rating
    await tx.userSkillRating.update({
      where: { id: currentSkill!.id },
      data: {
        ratingScore: new Prisma.Decimal(newRating),
        tasksCompleted: action === 'APPROVE' ? { increment: 1 } : undefined,
        tasksRejected: action === 'REJECT' ? { increment: 1 } : undefined,
      },
    });

    // 4.2 Append Time-Series Audit Log
    await tx.userSkillRatingLog.create({
      data: {
        userId,
        skillName: primarySkill,
        taskId: task.id,
        oldRating: new Prisma.Decimal(oldRating),
        newRating: new Prisma.Decimal(newRating),
        delta: new Prisma.Decimal(delta),
        eventType,
      },
    });

    // 4.3 Trigger semantic profile re-embedding flag
    await tx.userTalentProfile.updateMany({
      where: { userId },
      data: { isEmbeddingStale: true },
    });
  };

  if (externalTx) {
    await executeUpdates(externalTx);
  } else {
    await prisma.$transaction(async (tx) => {
      await executeUpdates(tx);
    });
  }

  return {
    userId,
    skillName: primarySkill,
    oldRating,
    newRating,
    delta,
    expectedScore: Number(expectedScore.toFixed(4)),
    actualScore,
    kFactor,
    eventType,
  };
}

