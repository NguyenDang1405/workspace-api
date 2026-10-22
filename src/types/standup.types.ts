import { z } from 'zod';

// ==========================================
// 1. ZOD SCHEMAS
// ==========================================
export const GenerateStandupSchema = z.object({
  reportDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Định dạng ngày phải là YYYY-MM-DD')
    .optional(),
  forceRegenerate: z.boolean().default(false),
});

export type GenerateStandupDto = z.infer<typeof GenerateStandupSchema>;

// ==========================================
// 2. FLOW METRICS SNAPSHOT
// ==========================================
export interface FlowMetricsSnapshot {
  activeWip: number;
  completedLast24h: number;
  blockedTasksCount: number;
  criticalPathRemainingHours: number;
  openPRsCount: number;
  burnRateAlert?: boolean;
}

// ==========================================
// 3. STANDUP REPORT DTO
// ==========================================
export interface StandupReportDto {
  id: string;
  projectId: string;
  reportDate: string;
  summaryYesterday: string;
  planToday: string;
  identifiedBlockers: string;
  flowMetrics: FlowMetricsSnapshot;
  createdAt: string;
}

