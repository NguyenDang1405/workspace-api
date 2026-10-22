import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import OpenAI from 'openai';
import {
  MonteCarloSimulationResult,
  MitigationStrategyDto,
  ReschedulingResponseData,
} from '@/types/rescheduling.types';
import { runKahnAndCPM } from '@/services/cpm.service';
import { TaskNodeInput } from '@/types/dag.types';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || 'dummy-key-for-build',
  timeout: 8000,
});

/**
 * Samples a random number from a Normal Distribution N(mean, stdDev)
 * using the Box-Muller transform.
 */
export function sampleNormal(mean: number, stdDev: number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  return mean + z * stdDev;
}

/**
 * Generates AI-recommended mitigation strategies (Fast-tracking / Crashing)
 * using gpt-4o-mini when schedule delays occur.
 */
export async function generateMitigationStrategy(
  projectName: string,
  delayedTaskTitle: string,
  delayHours: number,
  criticalTasks: string[]
): Promise<MitigationStrategyDto> {
  const prompt = `Bạn là Chuyên gia Lập kế hoạch Dự án (Project Controls Director).
Dự án "${projectName}" đang gặp sự cố trễ hạn:
- Tác vụ gây trễ: "${delayedTaskTitle}" (trễ ${delayHours} giờ).
- Các tác vụ đang nằm trên đường găng nguy cấp: ${JSON.stringify(criticalTasks)}.

Hãy đưa ra giải pháp khắc phục ngắn gọn bằng kỹ thuật Fast-tracking (chạy song song) hoặc Crashing (tăng nhân lực).
Trả về JSON chuẩn format:
{
  "strategyType": "FAST_TRACKING" | "CRASHING",
  "recommendationSummary": "<hướng dẫn cụ thể 2-3 câu>",
  "affectedTaskIds": [],
  "estimatedHoursSaved": <số giờ tiết kiệm dự kiến>
}`;

  try {
    const res = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature: 0.2,
    });
    const parsed = JSON.parse(res.choices[0].message.content || '{}');
    return {
      strategyType:
        parsed.strategyType === 'FAST_TRACKING' || parsed.strategyType === 'CRASHING'
          ? parsed.strategyType
          : 'CRASHING',
      recommendationSummary:
        parsed.recommendationSummary ||
        'Cân nhắc tăng cường thêm Senior Engineer hỗ trợ các task trên đường găng.',
      affectedTaskIds: Array.isArray(parsed.affectedTaskIds) ? parsed.affectedTaskIds : [],
      estimatedHoursSaved:
        typeof parsed.estimatedHoursSaved === 'number'
          ? parsed.estimatedHoursSaved
          : Number((delayHours * 0.5).toFixed(1)),
    };
  } catch (err) {
    console.warn('[Mitigation Strategy Warning - Fallback to heuristic]:', err);
    return {
      strategyType: 'CRASHING',
      recommendationSummary:
        'Cân nhắc điều động thêm Senior Engineer hỗ trợ các task găng để đẩy nhanh tiến độ.',
      affectedTaskIds: [],
      estimatedHoursSaved: Number((delayHours * 0.5).toFixed(1)),
    };
  }
}

/**
 * Executes Monte Carlo schedule risk simulation (N iterations) with PERT-Beta distribution.
 * Time Complexity: O(N * (|V| + |E|))
 */
export async function runMonteCarloSimulation(
  projectId: string,
  iterations: number = 1000
): Promise<MonteCarloSimulationResult> {
  const tasks = await prisma.task.findMany({
    where: { projectId },
    select: {
      id: true,
      estimatedHours: true,
      actualHours: true,
      status: true,
      isBlocked: true,
      earlyFinish: true,
    },
  });

  if (tasks.length === 0) {
    throw new Error('PROJECT_HAS_NO_TASKS');
  }

  const dependencies = await prisma.taskDependency.findMany({
    where: {
      predecessor: { projectId },
    },
    select: {
      predecessorId: true,
      successorId: true,
    },
  });

  // Build Adjacency List and compute In-Degrees
  const adj = new Map<string, string[]>();
  const inDegree = new Map<string, number>();
  const taskMap = new Map<string, (typeof tasks)[0]>();

  tasks.forEach((t) => {
    adj.set(t.id, []);
    inDegree.set(t.id, 0);
    taskMap.set(t.id, t);
  });

  dependencies.forEach((d) => {
    if (adj.has(d.predecessorId) && inDegree.has(d.successorId)) {
      adj.get(d.predecessorId)!.push(d.successorId);
      inDegree.set(d.successorId, (inDegree.get(d.successorId) || 0) + 1);
    }
  });

  // Kahn's Algorithm for Topological Order
  const queue: string[] = [];
  inDegree.forEach((deg, id) => {
    if (deg === 0) queue.push(id);
  });

  const topoOrder: string[] = [];
  while (queue.length > 0) {
    const u = queue.shift()!;
    topoOrder.push(u);
    adj.get(u)?.forEach((v) => {
      const newDeg = inDegree.get(v)! - 1;
      inDegree.set(v, newDeg);
      if (newDeg === 0) queue.push(v);
    });
  }

  // Pre-calculate predecessor mapping for high-speed Monte Carlo loop
  const predecessorMap = new Map<string, string[]>();
  tasks.forEach((t) => predecessorMap.set(t.id, []));
  dependencies.forEach((d) => {
    if (predecessorMap.has(d.successorId)) {
      predecessorMap.get(d.successorId)!.push(d.predecessorId);
    }
  });

  const originalMakespan = Math.max(...tasks.map((t) => Number(t.earlyFinish)), 0);
  const makespanRuns: number[] = new Array(iterations);

  // Monte Carlo Simulation Loop
  for (let i = 0; i < iterations; i++) {
    const taskDurations = new Map<string, number>();

    tasks.forEach((t) => {
      if (t.status === 'DONE') {
        const doneHours = Number(t.actualHours) || Number(t.estimatedHours);
        taskDurations.set(t.id, doneHours);
      } else {
        const est = Number(t.estimatedHours) || 4.0;
        const a = 0.8 * est;
        const m = 1.0 * est;
        const b = t.isBlocked ? 2.0 * est : 1.5 * est;
        const mean = (a + 4 * m + b) / 6.0;
        const std = (b - a) / 6.0;

        let sampled = sampleNormal(mean, std);
        sampled = Math.max(a, Math.min(b, sampled));
        taskDurations.set(t.id, sampled);
      }
    });

    // Fast Forward Pass
    const ef = new Map<string, number>();
    let iterMakespan = 0;

    for (const taskId of topoOrder) {
      let maxPredEf = 0;
      const preds = predecessorMap.get(taskId) || [];
      for (const predId of preds) {
        const predEf = ef.get(predId) || 0;
        if (predEf > maxPredEf) maxPredEf = predEf;
      }

      const finishTime = maxPredEf + (taskDurations.get(taskId) || 0);
      ef.set(taskId, finishTime);
      if (finishTime > iterMakespan) iterMakespan = finishTime;
    }

    makespanRuns[i] = iterMakespan;
  }

  makespanRuns.sort((a, b) => a - b);
  const p50 = Number(makespanRuns[Math.floor(iterations * 0.5)].toFixed(1));
  const p80 = Number(makespanRuns[Math.floor(iterations * 0.8)].toFixed(1));
  const p95 = Number(makespanRuns[Math.floor(iterations * 0.95)].toFixed(1));
  const meanMakespan = Number(
    (makespanRuns.reduce((sum, v) => sum + v, 0) / iterations).toFixed(1)
  );

  const variance =
    makespanRuns.reduce((sum, v) => sum + Math.pow(v - meanMakespan, 2), 0) / iterations;
  const stdDev = Number(Math.sqrt(variance).toFixed(1));

  // Percentage of runs completing within original makespan * 1.10
  const onTimeCount = makespanRuns.filter((m) => m <= originalMakespan * 1.1).length;
  const probabilityOnTime = Number(((onTimeCount / iterations) * 100).toFixed(1));

  // 10-Bin Histogram calculation (sum of frequencies == iterations)
  const minVal = makespanRuns[0];
  const maxVal = makespanRuns[iterations - 1];
  const binStep = (maxVal - minVal) / 10.0 || 1.0;
  const histogram: Array<{ binHours: number; frequency: number }> = [];

  for (let b = 0; b < 10; b++) {
    const binStart = minVal + b * binStep;
    const binEnd = binStart + binStep;
    const count = makespanRuns.filter(
      (v) => v >= binStart && (b === 9 ? v <= binEnd : v < binEnd)
    ).length;
    histogram.push({
      binHours: Number((binStart + binStep / 2).toFixed(1)),
      frequency: count,
    });
  }

  return {
    iterations,
    originalMakespanHours: Number(originalMakespan.toFixed(1)),
    meanMakespanHours: meanMakespan,
    standardDeviationHours: stdDev,
    p50Hours: p50,
    p80Hours: p80,
    p95Hours: p95,
    probabilityOnTime,
    histogram,
  };
}

/**
 * Analyzes delay propagation, recalibrates CPM graph, records rescheduling events,
 * and updates task schedules in PostgreSQL.
 */
export async function executeDynamicReschedule(
  projectId: string,
  triggerTaskId?: string | null,
  actualDelayHours: number = 4.0,
  reason: string = 'Task progress deviation detected'
): Promise<ReschedulingResponseData> {
  // 1. Fetch Project and Tasks
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true },
  });

  if (!project) {
    throw new Error('PROJECT_NOT_FOUND');
  }

  const tasks = await prisma.task.findMany({
    where: { projectId },
    select: {
      id: true,
      title: true,
      estimatedHours: true,
      actualHours: true,
      status: true,
      earlyStart: true,
      earlyFinish: true,
      lateStart: true,
      lateFinish: true,
      slackTime: true,
      isCriticalPath: true,
    },
  });

  if (tasks.length === 0) {
    throw new Error('PROJECT_HAS_NO_TASKS');
  }

  const dependencies = await prisma.taskDependency.findMany({
    where: {
      predecessor: { projectId },
    },
    select: {
      predecessorId: true,
      successorId: true,
    },
  });

  const originalMakespan = Math.max(...tasks.map((t) => Number(t.earlyFinish)), 0);

  // 2. Identify Trigger Task and Slack Absorption
  let triggerTask: (typeof tasks)[0] | undefined;
  let absorbedBySlack = 0;

  if (triggerTaskId) {
    triggerTask = tasks.find((t) => t.id === triggerTaskId);
    if (!triggerTask) {
      throw new Error('TRIGGER_TASK_NOT_FOUND');
    }
    const currentSlack = Number(triggerTask.slackTime);
    absorbedBySlack = Math.min(currentSlack, actualDelayHours);
  }

  // 3. Build TaskNodeInput array for Kahn & CPM
  const taskNodeInputs: TaskNodeInput[] = tasks.map((t) => {
    const isTrigger = t.id === triggerTaskId;
    const baseDuration = Number(t.estimatedHours);
    const duration = isTrigger ? baseDuration + actualDelayHours : baseDuration;

    const predecessors = dependencies
      .filter((d) => d.successorId === t.id)
      .map((d) => d.predecessorId);

    return {
      tempId: t.id,
      estimatedHours: duration,
      predecessors,
    };
  });

  // 4. Recalculate CPM Graph
  const cpmResult = runKahnAndCPM(taskNodeInputs);
  const newMakespan = cpmResult.projectMakespan;
  const deltaHours = Math.max(0, Number((newMakespan - originalMakespan).toFixed(2)));
  const isDelayAbsorbed = deltaHours < 0.05;

  let mitigationStrategy: MitigationStrategyDto | null = null;
  let reschedulingEventId: string | null = null;

  // 5. Generate AI Mitigation Strategy if project is extended
  if (!isDelayAbsorbed && deltaHours > 0) {
    const criticalTaskTitles = cpmResult.criticalPath
      .map((id) => tasks.find((t) => t.id === id)?.title || id)
      .slice(0, 5);

    mitigationStrategy = await generateMitigationStrategy(
      project.name,
      triggerTask?.title || 'Unknown Trigger Task',
      deltaHours,
      criticalTaskTitles
    );
  }

  // 6. Atomic Database Transaction: Update CPM metrics & Save Rescheduling Event
  await prisma.$transaction(async (tx) => {
    // 6.1 Update all tasks with new CPM metrics
    for (const t of tasks) {
      const cpm = cpmResult.cpmResults.get(t.id);
      if (cpm) {
        const isTrigger = t.id === triggerTaskId;
        const newEstimatedHours = isTrigger
          ? Number(t.estimatedHours) + actualDelayHours
          : Number(t.estimatedHours);

        await tx.task.update({
          where: { id: t.id },
          data: {
            estimatedHours: new Prisma.Decimal(newEstimatedHours),
            earlyStart: new Prisma.Decimal(cpm.earlyStart),
            earlyFinish: new Prisma.Decimal(cpm.earlyFinish),
            lateStart: new Prisma.Decimal(cpm.lateStart),
            lateFinish: new Prisma.Decimal(cpm.lateFinish),
            slackTime: new Prisma.Decimal(cpm.slackTime),
            isCriticalPath: cpm.isCriticalPath,
          },
        });
      }
    }

    // 6.2 Log event into rescheduling_events only if project schedule is actually extended (deltaHours > 0)
    if (deltaHours > 0) {
      const event = await tx.reschedulingEvent.create({
        data: {
          projectId,
          triggerTaskId: triggerTaskId || null,
          reason,
          originalMakespanDays: new Prisma.Decimal(
            Number((originalMakespan / 8.0).toFixed(1))
          ),
          newMakespanDays: new Prisma.Decimal(Number((newMakespan / 8.0).toFixed(1))),
          mitigationStrategy: mitigationStrategy as any,
        },
      });
      reschedulingEventId = event.id;
    }
  });

  return {
    projectId,
    originalMakespanHours: Number(originalMakespan.toFixed(1)),
    newMakespanHours: Number(newMakespan.toFixed(1)),
    deltaHours,
    isDelayAbsorbed,
    absorbedBySlackHours: Number(absorbedBySlack.toFixed(1)),
    criticalTasksCount: cpmResult.criticalPath.length,
    mitigationStrategy,
    reschedulingEventId,
  };
}
