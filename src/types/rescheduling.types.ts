import { z } from 'zod';

// ==========================================
// 1. ZOD SCHEMAS
// ==========================================
export const TriggerRescheduleSchema = z.object({
  triggerTaskId: z.string().uuid('ID task không hợp lệ').optional().nullable(),
  reason: z.string().min(3).max(100),
  actualDelayHours: z.number().min(0.1).max(200).default(4.0),
});

export type TriggerRescheduleDto = z.infer<typeof TriggerRescheduleSchema>;

// ==========================================
// 2. MONTE CARLO SIMULATION INTERFACES
// ==========================================
export interface MonteCarloSimulationResult {
  iterations: number;
  originalMakespanHours: number;
  meanMakespanHours: number;
  standardDeviationHours: number;
  p50Hours: number;
  p80Hours: number;
  p95Hours: number;
  probabilityOnTime: number;
  histogram: Array<{ binHours: number; frequency: number }>;
}

// ==========================================
// 3. MITIGATION STRATEGY DTOS
// ==========================================
export interface MitigationStrategyDto {
  strategyType: 'FAST_TRACKING' | 'CRASHING' | 'SCOPE_REDUCTION';
  recommendationSummary: string;
  affectedTaskIds: string[];
  estimatedHoursSaved: number;
}

export interface ReschedulingResponseData {
  projectId: string;
  originalMakespanHours: number;
  newMakespanHours: number;
  deltaHours: number;
  isDelayAbsorbed: boolean;
  absorbedBySlackHours: number;
  criticalTasksCount: number;
  mitigationStrategy?: MitigationStrategyDto | null;
  reschedulingEventId?: string | null;
}

