import { prisma } from '@/lib/prisma';
import {
  KanbanCardDto,
  KanbanColumnData,
  KanbanBoardResponseData,
  FlowMetricsDto,
  TaskStatusType,
  CumulativeFlowPoint,
} from '@/types/kanban.types';

// ==========================================
// 1. FINITE STATE MACHINE (FSM) RULES
// ==========================================
export const VALID_TRANSITIONS: Record<string, string[]> = {
  SCHEDULED: ['TODO'],
  TODO: ['IN_PROGRESS', 'SCHEDULED'],
  IN_PROGRESS: ['REVIEW', 'TODO'],
  REVIEW: ['DONE', 'IN_PROGRESS'], // IN_PROGRESS when rejected by reviewer
  DONE: [], // Terminal state
};

/**
 * Validates whether transition from `fromStatus` to `toStatus` conforms to FSM graph.
 */
export function validateFSMTransition(fromStatus: string, toStatus: string): boolean {
  if (fromStatus === toStatus) return true;
  return VALID_TRANSITIONS[fromStatus]?.includes(toStatus) || false;
}

/**
 * Calculate Upper Fence Threshold via Interquartile Range (IQR):
 * Threshold_Upper = Q3 + 1.5 * (Q3 - Q1)
 * Defaults to 48.0h if sample size is < 4.
 */
export function calculateIQRThreshold(durations: number[]): number {
  const valid = durations.filter((d) => d > 0);
  if (valid.length < 4) return 48.0;

  const sorted = [...valid].sort((a, b) => a - b);
  const q1Index = Math.floor(sorted.length * 0.25);
  const q3Index = Math.floor(sorted.length * 0.75);
  const q1 = sorted[q1Index];
  const q3 = sorted[q3Index];
  const iqr = q3 - q1;

  return Number((q3 + 1.5 * iqr).toFixed(1));
}

/**
 * Retrieves Kanban Board columns and flags bottleneck tasks for a project.
 */
export async function getProjectKanbanBoard(projectId: string): Promise<KanbanBoardResponseData> {
  const tasks = await prisma.task.findMany({
    where: { projectId },
    select: {
      id: true,
      title: true,
      priority: true,
      targetDepartment: true,
      requiredLevel: true,
      estimatedHours: true,
      actualHours: true,
      status: true,
      isCriticalPath: true,
      isBlocked: true,
      blockReason: true,
      checklist: true,
      startedAt: true,
      inReviewAt: true,
      completedAt: true,
      createdAt: true,
      updatedAt: true,
      assignee: {
        select: {
          id: true,
          fullName: true,
          avatarUrl: true,
        },
      },
      statusHistories: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: {
          createdAt: true,
        },
      },
    },
    orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
  });

  const now = new Date();

  // 1. Collect cycle durations to compute dynamic IQR threshold
  const completedCycleTimes: number[] = [];
  tasks.forEach((t) => {
    if (t.status === 'DONE' && t.startedAt && t.completedAt) {
      const hours = (t.completedAt.getTime() - t.startedAt.getTime()) / (1000 * 60 * 60);
      if (hours > 0) completedCycleTimes.push(hours);
    }
  });

  const iqrThresholdHours = calculateIQRThreshold(completedCycleTimes);

  // 2. Map and flag bottleneck tasks
  const cards: KanbanCardDto[] = tasks.map((task) => {
    const lastStatusDate = task.statusHistories[0]?.createdAt || task.updatedAt || task.createdAt;
    const timeInCurrentStatusHours = Number(
      Math.max(0, (now.getTime() - new Date(lastStatusDate).getTime()) / (1000 * 60 * 60)).toFixed(1)
    );

    // Bottleneck flagged if task in IN_PROGRESS or REVIEW exceeds IQR upper fence
    const isBottleneck =
      ['IN_PROGRESS', 'REVIEW'].includes(task.status) &&
      timeInCurrentStatusHours > iqrThresholdHours;

    let checklistTotal = 0;
    let checklistCompleted = 0;

    if (Array.isArray(task.checklist)) {
      checklistTotal = task.checklist.length;
      checklistCompleted = task.checklist.filter(
        (it: any) => it.isCompleted === true || it.done === true
      ).length;
    }

    return {
      id: task.id,
      title: task.title,
      priority: task.priority,
      department: task.targetDepartment,
      requiredLevel: task.requiredLevel,
      estimatedHours: Number(task.estimatedHours),
      actualHours: task.actualHours ? Number(task.actualHours) : null,
      isCriticalPath: task.isCriticalPath,
      isBlocked: task.isBlocked,
      blockReason: task.blockReason,
      isBottleneck,
      timeInCurrentStatusHours,
      checklistProgress: {
        total: checklistTotal,
        completed: checklistCompleted,
      },
      assignee: task.assignee
        ? {
            id: task.assignee.id,
            fullName: task.assignee.fullName,
            avatarUrl: task.assignee.avatarUrl,
          }
        : null,
    };
  });

  // 3. Assemble the 5 standard Kanban columns
  const columnStatuses: TaskStatusType[] = ['SCHEDULED', 'TODO', 'IN_PROGRESS', 'REVIEW', 'DONE'];
  const columns: KanbanColumnData[] = columnStatuses.map((status) => {
    const columnTasks = cards.filter((c) => {
      const rawTask = tasks.find((t) => t.id === c.id);
      return rawTask?.status === status;
    });

    return {
      status,
      count: columnTasks.length,
      tasks: columnTasks,
    };
  });

  return {
    projectId,
    iqrThresholdHours,
    columns,
  };
}

/**
 * Calculates Flow Observability Metrics:
 * - Work In Progress (WIP)
 * - Throughput (tasks/day)
 * - Average Cycle Time (hours)
 * - Average Lead Time (hours)
 * - Little's Law Discrepancy: |L - lambda * W|
 * - IQR Upper Fence Threshold
 * - Cumulative Flow Diagram (CFD) series
 */
export async function getProjectFlowMetrics(
  projectId: string,
  daysWindow: number = 14
): Promise<FlowMetricsDto> {
  const safeDays = Math.max(1, Math.min(90, daysWindow));

  const tasks = await prisma.task.findMany({
    where: { projectId },
    select: {
      id: true,
      status: true,
      startedAt: true,
      inReviewAt: true,
      completedAt: true,
      createdAt: true,
      actualHours: true,
    },
  });

  const now = new Date();
  const windowStart = new Date(now.getTime() - safeDays * 24 * 60 * 60 * 1000);

  // 1. WIP Count: active tasks in WIP states
  const wipCount = tasks.filter((t) => ['TODO', 'IN_PROGRESS', 'REVIEW'].includes(t.status)).length;

  // 2. Throughput: completed tasks in window divided by window days
  const completedInWindow = tasks.filter(
    (t) => t.status === 'DONE' && t.completedAt && t.completedAt >= windowStart
  );
  const throughputPerDay = Number((completedInWindow.length / safeDays).toFixed(2));

  // 3. Average Cycle Time (completedAt - startedAt)
  const completedCycleTimes: number[] = [];
  tasks.forEach((t) => {
    if (t.status === 'DONE' && t.startedAt && t.completedAt) {
      const hours = (t.completedAt.getTime() - t.startedAt.getTime()) / (1000 * 60 * 60);
      if (hours > 0) completedCycleTimes.push(hours);
    }
  });

  const avgCycleTimeHours =
    completedCycleTimes.length > 0
      ? Number(
          (
            completedCycleTimes.reduce((sum, h) => sum + h, 0) / completedCycleTimes.length
          ).toFixed(1)
        )
      : 0.0;

  // 4. Average Lead Time (completedAt - createdAt)
  const completedLeadTimes: number[] = [];
  tasks.forEach((t) => {
    if (t.status === 'DONE' && t.completedAt) {
      const hours = (t.completedAt.getTime() - t.createdAt.getTime()) / (1000 * 60 * 60);
      if (hours > 0) completedLeadTimes.push(hours);
    }
  });

  const avgLeadTimeHours =
    completedLeadTimes.length > 0
      ? Number(
          (
            completedLeadTimes.reduce((sum, h) => sum + h, 0) / completedLeadTimes.length
          ).toFixed(1)
        )
      : avgCycleTimeHours;

  // 5. Little's Law Consistency: L = lambda * W
  const lambdaPerHour = throughputPerDay / 24.0;
  const theoreticalWIP = lambdaPerHour * avgCycleTimeHours;
  const littlesLawDiscrepancy = Number(Math.abs(wipCount - theoreticalWIP).toFixed(2));

  // 6. Dynamic IQR Outlier Threshold
  const iqrThresholdHours = calculateIQRThreshold(completedCycleTimes);

  // 7. Cumulative Flow Diagram (CFD) series across days
  const cfdData: CumulativeFlowPoint[] = [];
  const snapshotDays = Math.min(safeDays, 14);

  for (let i = snapshotDays - 1; i >= 0; i--) {
    const dayDate = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    const dayEnd = new Date(dayDate.getFullYear(), dayDate.getMonth(), dayDate.getDate(), 23, 59, 59, 999);
    const dateStr = dayDate.toISOString().split('T')[0];

    const tasksCreatedByDay = tasks.filter((t) => t.createdAt <= dayEnd);
    const doneByDay = tasksCreatedByDay.filter((t) => t.status === 'DONE' && t.completedAt && t.completedAt <= dayEnd).length;
    const reviewByDay = tasksCreatedByDay.filter((t) => t.status === 'REVIEW' || (t.inReviewAt && t.inReviewAt <= dayEnd && (!t.completedAt || t.completedAt > dayEnd))).length;
    const inProgressByDay = tasksCreatedByDay.filter((t) => t.status === 'IN_PROGRESS' || (t.startedAt && t.startedAt <= dayEnd && (!t.inReviewAt || t.inReviewAt > dayEnd) && (!t.completedAt || t.completedAt > dayEnd))).length;
    const todoByDay = tasksCreatedByDay.filter((t) => t.status === 'TODO').length;
    const scheduledByDay = tasksCreatedByDay.filter((t) => t.status === 'SCHEDULED').length;

    cfdData.push({
      date: dateStr,
      scheduled: scheduledByDay,
      todo: todoByDay,
      inProgress: inProgressByDay,
      review: reviewByDay,
      done: doneByDay,
    });
  }

  return {
    projectId,
    wipCount,
    throughputPerDay,
    avgCycleTimeHours,
    avgLeadTimeHours,
    littlesLawDiscrepancy,
    iqrThresholdHours,
    cfdData,
  };
}
