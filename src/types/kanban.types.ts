import { z } from 'zod';

// ==========================================
// 1. ZOD ENUMS & SCHEMAS
// ==========================================
export const TaskStatusEnum = z.enum(['SCHEDULED', 'TODO', 'IN_PROGRESS', 'REVIEW', 'DONE']);
export type TaskStatusType = z.infer<typeof TaskStatusEnum>;

export const ChecklistUpdateItemSchema = z.object({
  id: z.string(),
  isCompleted: z.boolean(),
});

export const UpdateTaskStatusSchema = z.object({
  toStatus: TaskStatusEnum,
  blockReason: z.string().max(255).optional().nullable(),
  checklistUpdates: z.array(ChecklistUpdateItemSchema).optional(),
});
export type UpdateTaskStatusDto = z.infer<typeof UpdateTaskStatusSchema>;

// ==========================================
// 2. KANBAN BOARD CARD & COLUMN DTOS
// ==========================================
export interface KanbanCardDto {
  id: string;
  title: string;
  priority: string;
  department: string;
  requiredLevel: string;
  estimatedHours: number;
  actualHours: number | null;
  isCriticalPath: boolean;
  isBlocked: boolean;
  blockReason: string | null;
  isBottleneck: boolean;
  timeInCurrentStatusHours: number;
  checklistProgress: {
    total: number;
    completed: number;
  };
  assignee: {
    id: string;
    fullName: string;
    avatarUrl: string | null;
  } | null;
}

export interface KanbanColumnData {
  status: TaskStatusType;
  count: number;
  tasks: KanbanCardDto[];
}

export interface KanbanBoardResponseData {
  projectId: string;
  iqrThresholdHours: number;
  columns: KanbanColumnData[];
}

// ==========================================
// 3. FLOW METRICS & LITTLE'S LAW DTOS
// ==========================================
export interface CumulativeFlowPoint {
  date: string;
  scheduled: number;
  todo: number;
  inProgress: number;
  review: number;
  done: number;
}

export interface FlowMetricsDto {
  projectId: string;
  wipCount: number;
  throughputPerDay: number;
  avgCycleTimeHours: number;
  avgLeadTimeHours: number;
  littlesLawDiscrepancy: number; // Sai số kiểm chứng |L - lambda * W|
  iqrThresholdHours: number;
  cfdData: CumulativeFlowPoint[];
}

