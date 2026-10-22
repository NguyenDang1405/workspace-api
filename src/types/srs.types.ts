import { z } from 'zod';

// ==========================================
// 1. ZOD SCHEMAS
// ==========================================
export const IngestDocumentSchema = z.object({
  fileName: z.string().min(1).max(255),
  fileUrl: z.string().url().default('https://storage.workspace.local/sample-srs.md'),
  rawContent: z.string().min(50, 'Nội dung tài liệu tối thiểu 50 ký tự'),
});

export type IngestDocumentDto = z.infer<typeof IngestDocumentSchema>;

export const UserStorySchema = z.object({
  storyId: z.string(),
  role: z.string(),
  action: z.string(),
  benefit: z.string(),
  fullTitle: z.string(),
  description: z.string(),
  targetDepartment: z.enum(['FRONTEND', 'BACKEND', 'DEVOPS', 'QA', 'FULLSTACK']),
  complexity: z.enum(['EASY', 'MEDIUM', 'HARD']),
  acceptanceCriteria: z.array(z.string()).min(1),
  dependsOnStories: z.array(z.string()).default([]),
});

export type UserStoryDto = z.infer<typeof UserStorySchema>;

// ==========================================
// 2. DTO & RESPONSE INTERFACES
// ==========================================
export interface ExtractedStoriesResult {
  documentId: string;
  projectId: string;
  fileName: string;
  totalStories: number;
  stories: UserStoryDto[];
}

export interface ProjectDocumentDto {
  id: string;
  projectId: string;
  fileName: string;
  fileUrl: string;
  rawContent: string | null;
  extractedStories: UserStoryDto[];
  createdAt: string;
}

export interface SeedFromSrsResult {
  projectId: string;
  documentId: string;
  totalStories: number;
  totalTasksCreated: number;
  projectMakespan: number;
  criticalTasksCount: number;
}

