import { z } from 'zod';

// ==========================================
// 1. ZOD SCHEMAS
// ==========================================
export const ConfirmAssignmentItemSchema = z.object({
  taskId: z.string().uuid('ID nhiệm vụ không hợp lệ'),
  finalAssigneeId: z.string().uuid('ID nhân sự không hợp lệ'),
  startDate: z.string().refine((val) => !isNaN(Date.parse(val)), {
    message: 'Ngày bắt đầu không hợp lệ (chuẩn ISO 8601)',
  }),
  dueDate: z.string().refine((val) => !isNaN(Date.parse(val)), {
    message: 'Hạn chót không hợp lệ (chuẩn ISO 8601)',
  }),
  overrideReason: z.string().max(500, 'Lý do ghi đè không được vượt quá 500 ký tự').optional(),
});

export const ConfirmAssignmentsSchema = z.object({
  confirmations: z
    .array(ConfirmAssignmentItemSchema)
    .min(1, 'Danh sách xác nhận phải chứa ít nhất 1 nhiệm vụ'),
});

export type ConfirmAssignmentItemInput = z.infer<typeof ConfirmAssignmentItemSchema>;
export type ConfirmAssignmentsInput = z.infer<typeof ConfirmAssignmentsSchema>;

// ==========================================
// 2. DTO INTERFACES FOR AUTO-DISPATCH PLAN
// ==========================================
export interface SuggestedAssignee {
  userId: string;
  fullName: string;
  email: string;
  matchScore: number;
  matchReason: string;
}

export interface ScheduleTimeline {
  startDate: string;
  dueDate: string;
}

export interface CandidateScoreSummary {
  userId: string;
  fullName: string;
  matchScore: number;
  matchReason?: string;
}

export interface AutoDispatchAssignment {
  taskId: string;
  taskTitle: string;
  estimatedHours: number;
  isCriticalPath: boolean;
  suggestedAssignee: SuggestedAssignee;
  schedule: ScheduleTimeline;
  availableCandidates: CandidateScoreSummary[];
}

export interface AutoDispatchPlanResponseData {
  projectId: string;
  totalTasks: number;
  estimatedCompletionDate: string;
  assignments: AutoDispatchAssignment[];
}

export interface ConfirmAssignmentsResponseData {
  projectId: string;
  confirmedCount: number;
  tasks: Array<{
    id: string;
    title: string;
    assignedTo: string;
    startDate: string;
    dueDate: string;
    status: string;
    isHumanOverride: boolean;
  }>;
}
