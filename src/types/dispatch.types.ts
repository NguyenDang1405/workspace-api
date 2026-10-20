import { z } from 'zod';
import { Department, Level } from '@/types';

// ==========================================
// 1. ZOD SCHEMAS FOR DISPATCH REQUEST
// ==========================================
export const DispatchTaskSchema = z.object({
  assignedUserId: z.string().uuid('ID nhân sự không hợp lệ'),
  overrideReason: z.string().max(500, 'Lý do ghi đè không được vượt quá 500 ký tự').optional(),
});
export type DispatchTaskInput = z.infer<typeof DispatchTaskSchema>;

// ==========================================
// 2. CANDIDATE COMPOSITE SCORING INTERFACES
// ==========================================
export interface DispatchScoredCandidate {
  userId: string;
  fullName: string;
  email: string;
  department: Department | string;
  level: Level | string;
  rawRrfScore: number;
  normalizedRrf: number;
  eloScore: number;
  normalizedElo: number;
  activeWorkload: number;
  workloadPenalty: number;
  criticalBonus: number;
  compositeScore: number;
}

// ==========================================
// 3. ADAPTIVE GUIDANCE CHECKLIST INTERFACES
// ==========================================
export type ChecklistCategory = 'PREREQUISITE' | 'IMPLEMENTATION' | 'TESTING' | 'SECURITY';

export interface AdaptiveChecklistItem {
  id: string;
  taskText: string;
  isCompleted: boolean;
  category: ChecklistCategory;
}

// ==========================================
// 4. API RESPONSE DATA DTO
// ==========================================
export interface DispatchTaskResponseData {
  taskId: string;
  taskTitle: string;
  assignedUserId: string;
  assignedUserName: string;
  assignedUserLevel: string;
  isHumanOverride: boolean;
  overrideReason: string | null;
  compositeScore: number | null;
  checklist: AdaptiveChecklistItem[];
  recommendedCandidates: Array<{
    userId: string;
    fullName: string;
    compositeScore: number;
    rawRrfScore: number;
    eloScore: number;
    activeWorkload: number;
  }>;
}

