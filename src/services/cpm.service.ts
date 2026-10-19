import {
  TaskNodeInput,
  CPMCalculatedTask,
  CPMAlgorithmResult,
} from '@/types/dag.types';

export class CyclicDependencyError extends Error {
  code: string;
  constructor(message: string) {
    super(message);
    this.name = 'CyclicDependencyError';
    this.code = 'CYCLIC_DEPENDENCY_DETECTED';
  }
}

/**
 * Executes Kahn's Algorithm for Topological Sorting & Cycle Detection,
 * followed by the Critical Path Method (CPM) for schedule analysis.
 *
 * Time Complexity: O(|V| + |E|)
 * Space Complexity: O(|V| + |E|)
 */
export function runKahnAndCPM(tasks: TaskNodeInput[]): CPMAlgorithmResult {
  if (!tasks || tasks.length === 0) {
    return {
      topologicalOrder: [],
      cpmResults: new Map(),
      projectMakespan: 0,
      criticalPath: [],
    };
  }

  // 1. Graph structures initialization
  const inDegree = new Map<string, number>();
  const adjList = new Map<string, string[]>(); // u (predecessor) -> list of v (successors)
  const taskMap = new Map<string, TaskNodeInput>();
  const validTempIds = new Set(tasks.map((t) => t.tempId));

  tasks.forEach((t) => {
    taskMap.set(t.tempId, t);
    inDegree.set(t.tempId, 0);
    adjList.set(t.tempId, []);
  });

  // 2. Build edges and compute in-degrees (filter out invalid/self references)
  tasks.forEach((t) => {
    const sanitizedPredecessors = t.predecessors.filter(
      (predId) => validTempIds.has(predId) && predId !== t.tempId
    );

    sanitizedPredecessors.forEach((predId) => {
      adjList.get(predId)!.push(t.tempId);
      inDegree.set(t.tempId, (inDegree.get(t.tempId) || 0) + 1);
    });

    // Update with sanitized predecessors
    t.predecessors = sanitizedPredecessors;
  });

  // 3. Kahn's Algorithm: Topological Sort
  const queue: string[] = [];
  inDegree.forEach((deg, id) => {
    if (deg === 0) {
      queue.push(id);
    }
  });

  const topologicalOrder: string[] = [];
  while (queue.length > 0) {
    const u = queue.shift()!;
    topologicalOrder.push(u);

    const neighbors = adjList.get(u) || [];
    for (const v of neighbors) {
      const currentDeg = inDegree.get(v)! - 1;
      inDegree.set(v, currentDeg);
      if (currentDeg === 0) {
        queue.push(v);
      }
    }
  }

  // Cycle check: If topologicalOrder does not contain all nodes, a cycle exists
  if (topologicalOrder.length !== tasks.length) {
    throw new CyclicDependencyError(
      'CYCLIC_DEPENDENCY_DETECTED: A circular dependency loop was found in the project DAG.'
    );
  }

  // 4. CPM: Forward Pass (Compute Early Start and Early Finish)
  const es = new Map<string, number>();
  const ef = new Map<string, number>();

  topologicalOrder.forEach((id) => {
    const task = taskMap.get(id)!;
    let maxPredEf = 0;

    for (const predId of task.predecessors) {
      const predEf = ef.get(predId) || 0;
      if (predEf > maxPredEf) {
        maxPredEf = predEf;
      }
    }

    const earlyStart = Math.round(maxPredEf * 100) / 100;
    const earlyFinish = Math.round((earlyStart + task.estimatedHours) * 100) / 100;

    es.set(id, earlyStart);
    ef.set(id, earlyFinish);
  });

  // Calculate Project Makespan (Duration of the entire project)
  let projectMakespan = 0;
  ef.forEach((val) => {
    if (val > projectMakespan) {
      projectMakespan = val;
    }
  });
  projectMakespan = Math.round(projectMakespan * 100) / 100;

  // 5. CPM: Backward Pass (Compute Late Finish and Late Start)
  const lf = new Map<string, number>();
  const ls = new Map<string, number>();

  // Default Late Finish of all nodes to project makespan
  topologicalOrder.forEach((id) => {
    lf.set(id, projectMakespan);
  });

  // Process in reverse topological order
  for (let i = topologicalOrder.length - 1; i >= 0; i--) {
    const id = topologicalOrder[i];
    const task = taskMap.get(id)!;
    const successors = adjList.get(id) || [];

    if (successors.length > 0) {
      let minSuccLs = Infinity;
      for (const succId of successors) {
        const succLs = ls.get(succId) ?? projectMakespan;
        if (succLs < minSuccLs) {
          minSuccLs = succLs;
        }
      }
      lf.set(id, Math.round(minSuccLs * 100) / 100);
    }

    const lateFinish = lf.get(id)!;
    const lateStart = Math.round((lateFinish - task.estimatedHours) * 100) / 100;
    ls.set(id, lateStart);
  }

  // 6. Calculate Slack & Identify Critical Path
  const cpmResults = new Map<string, CPMCalculatedTask>();
  const criticalPath: string[] = [];

  topologicalOrder.forEach((id) => {
    const earlyStart = es.get(id)!;
    const earlyFinish = ef.get(id)!;
    const lateStart = ls.get(id)!;
    const lateFinish = lf.get(id)!;
    const slackTime = Math.max(0, Math.round((lateStart - earlyStart) * 100) / 100);
    const isCriticalPath = Math.abs(slackTime) < 0.05;

    if (isCriticalPath) {
      criticalPath.push(id);
    }

    cpmResults.set(id, {
      tempId: id,
      earlyStart,
      earlyFinish,
      lateStart,
      lateFinish,
      slackTime,
      isCriticalPath,
    });
  });

  return {
    topologicalOrder,
    cpmResults,
    projectMakespan,
    criticalPath,
  };
}

/**
 * Helper to determine if an edge between two tasks is on the critical path.
 */
export function isEdgeCritical(
  predTask: { earlyFinish: number; isCriticalPath: boolean },
  succTask: { earlyStart: number; isCriticalPath: boolean }
): boolean {
  if (!predTask.isCriticalPath || !succTask.isCriticalPath) {
    return false;
  }
  return Math.abs(succTask.earlyStart - predTask.earlyFinish) < 0.05;
}

