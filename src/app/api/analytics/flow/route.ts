import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

// Calculate Interquartile Range (IQR) and quartiles
function calculateIQR(values: number[]) {
  if (values.length === 0) {
    return { count: 0, min: 0, max: 0, median: 0, q1: 0, q3: 0, iqr: 0, average: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const count = sorted.length;
  const min = sorted[0];
  const max = sorted[count - 1];
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  const average = Math.round((sum / count) * 100) / 100;

  const getPercentile = (p: number) => {
    const idx = (count - 1) * p;
    const lower = Math.floor(idx);
    const upper = Math.ceil(idx);
    const weight = idx - lower;
    if (lower === upper) return sorted[lower];
    return sorted[lower] * (1 - weight) + sorted[upper] * weight;
  };

  const q1 = Math.round(getPercentile(0.25) * 100) / 100;
  const median = Math.round(getPercentile(0.5) * 100) / 100;
  const q3 = Math.round(getPercentile(0.75) * 100) / 100;
  const iqr = Math.round((q3 - q1) * 100) / 100;

  return { count, min, max, median, q1, q3, iqr, average };
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get('projectId');

    // 1. Fetch completed tasks with startedAt and completedAt to compute cycle time
    const completedTasks = await prisma.task.findMany({
      where: {
        ...(projectId ? { projectId } : {}),
        status: 'DONE',
        startedAt: { not: null },
        completedAt: { not: null },
      },
      select: {
        id: true,
        title: true,
        startedAt: true,
        completedAt: true,
      },
    });

    const cycleTimesHours = completedTasks.map((t) => {
      const diffMs = new Date(t.completedAt!).getTime() - new Date(t.startedAt!).getTime();
      return Math.max(0, Math.round((diffMs / (1000 * 60 * 60)) * 100) / 100);
    });

    const cycleTimeStats = calculateIQR(cycleTimesHours);

    // 2. Fetch history durations grouped by status to find bottleneck stages
    const historyEntries = await prisma.taskStatusHistory.findMany({
      where: {
        ...(projectId ? { task: { projectId } } : {}),
        durationInPreviousStatusHours: { not: null },
      },
      select: {
        fromStatus: true,
        durationInPreviousStatusHours: true,
      },
    });

    const durationsByStatus: Record<string, number[]> = {};
    for (const entry of historyEntries) {
      const duration = Number(entry.durationInPreviousStatusHours || 0);
      if (!durationsByStatus[entry.fromStatus]) {
        durationsByStatus[entry.fromStatus] = [];
      }
      durationsByStatus[entry.fromStatus].push(duration);
    }

    const stageMetrics: Record<string, ReturnType<typeof calculateIQR>> = {};
    for (const [status, durations] of Object.entries(durationsByStatus)) {
      stageMetrics[status] = calculateIQR(durations);
    }

    // 3. Count currently blocked tasks
    const blockedTasksCount = await prisma.task.count({
      where: {
        ...(projectId ? { projectId } : {}),
        isBlocked: true,
      },
    });

    return NextResponse.json({
      cycleTime: cycleTimeStats,
      stageMetrics,
      blockedTasksCount,
    });
  } catch (error) {
    console.error('GET /api/analytics/flow Error:', error);
    return NextResponse.json({ error: 'Failed to calculate flow metrics' }, { status: 500 });
  }
}

