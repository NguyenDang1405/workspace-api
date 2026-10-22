import { z } from 'zod';

// ==========================================
// 1. GITHUB WEBHOOK PAYLOAD SCHEMAS
// ==========================================
export const GithubWebhookPayloadSchema = z.object({
  action: z.enum(['opened', 'reopened', 'closed', 'synchronize']).optional(),
  pull_request: z.object({
    number: z.number(),
    html_url: z.string().url(),
    title: z.string(),
    body: z.string().nullable().optional(),
    head: z.object({
      ref: z.string(), // Branch name e.g. feat/task-<UUID>
    }),
    user: z.object({
      login: z.string(),
    }),
    merged: z.boolean().optional().default(false),
    merged_at: z.string().nullable().optional(),
  }),
});

export type GithubWebhookPayload = z.infer<typeof GithubWebhookPayloadSchema>;

// ==========================================
// 2. AI CODE VERIFICATION INTERFACES
// ==========================================
export interface AIVerificationResult {
  score: number;
  isVerified: boolean;
  feedback: string;
}

// ==========================================
// 3. PULL REQUEST DTOS
// ==========================================
export interface GitPRDto {
  id: string;
  taskId: string;
  prNumber: number;
  prUrl: string;
  branchName: string;
  authorGithubUsername: string;
  diffSummary: string | null;
  aiVerificationFeedback: string | null;
  isVerifiedByAi: boolean;
  status: string;
  mergedAt: string | null;
  createdAt: string;
}

export interface TaskPullRequestsResponseData {
  taskId: string;
  pullRequests: GitPRDto[];
}

