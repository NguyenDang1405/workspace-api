import { z } from 'zod';

// ==========================================
// 1. ZOD ENUMS & SCHEMAS
// ==========================================
export const TaskReviewActionEnum = z.enum(['APPROVE', 'REJECT']);
export type TaskReviewAction = z.infer<typeof TaskReviewActionEnum>;

export const TaskReviewActionSchema = z.object({
  action: TaskReviewActionEnum,
  feedback: z.string().max(1000).optional().nullable(),
  primarySkill: z.string().min(1).max(50).default('General'),
});
export type TaskReviewActionDto = z.infer<typeof TaskReviewActionSchema>;

// ==========================================
// 2. ELO CALCULATION INTERFACES
// ==========================================
export interface EloCalculationResult {
  userId: string;
  skillName: string;
  oldRating: number;
  newRating: number;
  delta: number;
  expectedScore: number;
  actualScore: number;
  kFactor: number;
  eventType: 'TASK_DONE' | 'REVIEW_REJECT';
}

// ==========================================
// 3. TIME-SERIES SKILL HISTORY DTOS
// ==========================================
export interface SkillHistoryItemDto {
  id: string;
  skillName: string;
  taskId: string | null;
  taskTitle?: string | null;
  oldRating: number;
  newRating: number;
  delta: number;
  eventType: string;
  createdAt: string;
}

export interface UserSkillHistoryResponseData {
  userId: string;
  history: SkillHistoryItemDto[];
}

export interface TaskReviewResponseData {
  taskId: string;
  newStatus: 'DONE' | 'IN_PROGRESS';
  action: 'APPROVE' | 'REJECT';
  feedback: string | null;
  elo: EloCalculationResult;
}

