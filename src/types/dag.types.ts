import { z } from 'zod';
import { Department, Level, TaskPriority, TaskStatus } from '@/types';

// ==========================================
// 1. OPENAI STRUCTURED OUTPUTS SCHEMA
// ==========================================
export const TaskItemGeneratedSchema = z.object({
  tempId: z.string().describe('Temporary identifier like T1, T2, T3...'),
  title: z.string().min(3).describe('Concise technical title of the task'),
  description: z.string().min(5).describe('Detailed technical instructions and requirements'),
  targetDepartment: z.enum(['FRONTEND', 'BACKEND', 'DEVOPS', 'QA', 'FULLSTACK']),
  requiredLevel: z.enum(['INTERN', 'FRESHER', 'JUNIOR', 'MIDDLE', 'SENIOR']),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']),
  estimatedHours: z.number().min(1).max(40).describe('Estimated duration in hours (1-40)'),
  predecessorTempIds: z
    .array(z.string())
    .describe('Array of tempIds that must be completed before this task can start'),
});
export type TaskItemGenerated = z.infer<typeof TaskItemGeneratedSchema>;

export const DecomposeProjectResponseSchema = z.object({
  tasks: z.array(TaskItemGeneratedSchema).min(3).max(30),
});
export type DecomposeProjectResponse = z.infer<typeof DecomposeProjectResponseSchema>;

// ==========================================
// 2. CPM ALGORITHM TYPES
// ==========================================
export interface TaskNodeInput {
  tempId: string;
  estimatedHours: number;
  predecessors: string[];
}

export interface CPMCalculatedTask {
  tempId: string;
  earlyStart: number;
  earlyFinish: number;
  lateStart: number;
  lateFinish: number;
  slackTime: number;
  isCriticalPath: boolean;
}

export interface CPMAlgorithmResult {
  topologicalOrder: string[];
  cpmResults: Map<string, CPMCalculatedTask>;
  projectMakespan: number;
  criticalPath: string[];
}

// ==========================================
// 3. REACT FLOW DAG TYPES (FRONTEND READY)
// ==========================================
export interface ReactFlowTaskNodeData {
  title: string;
  department: Department;
  level: Level;
  estimatedHours: number;
  earlyStart: number;
  earlyFinish: number;
  lateStart: number;
  lateFinish: number;
  slackTime: number;
  isCriticalPath: boolean;
  status: TaskStatus;
  priority: TaskPriority;
  assignedTo?: string | null;
  assigneeName?: string | null;
}

export interface ReactFlowTaskNode {
  id: string;
  type: string;
  data: ReactFlowTaskNodeData;
  position: { x: number; y: number };
}

export interface ReactFlowDAGEdge {
  id: string;
  source: string;
  target: string;
  animated: boolean;
  style: {
    stroke: string;
    strokeWidth: number;
  };
  data?: {
    isCriticalEdge: boolean;
  };
}

export interface DAGGraphResponse {
  nodes: ReactFlowTaskNode[];
  edges: ReactFlowDAGEdge[];
  projectMakespan: number;
  totalTasks: number;
  criticalTasksCount: number;
}
