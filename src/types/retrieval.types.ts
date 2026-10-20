import { z } from 'zod';
import { Department, Level } from '@/types';

// ==========================================
// 1. ZOD SCHEMAS FOR QUERY VALIDATION
// ==========================================
export const CandidatesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10),
  allowCrossDept: z
    .union([
      z.boolean(),
      z.enum(['true', 'false']).transform((v) => v === 'true'),
    ])
    .default(false),
});
export type CandidatesQueryInput = z.infer<typeof CandidatesQuerySchema>;

// ==========================================
// 2. DTO INTERFACES
// ==========================================
export interface RankedCandidateDto {
  userId: string;
  fullName: string;
  email: string;
  department: Department | string;
  level: Level | string;
  skills: string[];
  sparseRank: number | null;
  denseRank: number | null;
  rrfScore: number;
  activeWorkload: number;
}

export interface TaskCandidatesResponseData {
  taskId: string;
  candidates: RankedCandidateDto[];
}

