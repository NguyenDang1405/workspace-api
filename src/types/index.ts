import { z } from 'zod';

// ==========================================
// 1. BASE ENUMS
// ==========================================
export type Role = 'ADMIN' | 'PM' | 'LEADER' | 'MEMBER';
export type Department = 'FRONTEND' | 'BACKEND' | 'DEVOPS' | 'QA' | 'FULLSTACK';
export type Level = 'INTERN' | 'FRESHER' | 'JUNIOR' | 'MIDDLE' | 'SENIOR';
export type Complexity = 'EASY' | 'MEDIUM' | 'HARD';
export type ProjectStatus = 'PLANNING' | 'ACTIVE' | 'COMPLETED' | 'ARCHIVED';
export type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
export type TaskStatus = 'SCHEDULED' | 'TODO' | 'IN_PROGRESS' | 'REVIEW' | 'DONE';
export type DispatchRunStatus = 'PREVIEW' | 'APPROVED' | 'CANCELLED';
export type SkillOutcome = 'ACCEPTED' | 'REJECTED' | 'OVERDUE';

// ==========================================
// 2. API ENVELOPE RESPONSE FORMAT
// ==========================================
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  message?: string;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  } | string;
}

// ==========================================
// 3. ZOD SCHEMAS & DTOS (MODULE 1 SPEC)
// ==========================================
export const RegisterSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  fullName: z.string().min(1).max(100, 'Full name cannot exceed 100 characters'),
  avatarUrl: z.string().url().nullable().optional(),
  role: z.enum(['ADMIN', 'PM', 'LEADER', 'MEMBER']).optional().default('MEMBER'),
  department: z.enum(['FRONTEND', 'BACKEND', 'DEVOPS', 'QA', 'FULLSTACK']).optional().default('FULLSTACK'),
  level: z.enum(['INTERN', 'FRESHER', 'JUNIOR', 'MIDDLE', 'SENIOR']).optional().default('JUNIOR'),
  skills: z.array(z.string()).optional().default([]),
  bioSummary: z.string().max(1000).optional(),
});
export type RegisterDto = z.infer<typeof RegisterSchema>;

export const LoginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});
export type LoginDto = z.infer<typeof LoginSchema>;

export const UpdateProfileSchema = z.object({
  targetUserId: z.string().uuid().optional(),
  fullName: z.string().min(1).max(100).optional(),
  avatarUrl: z.string().url().nullable().optional(),
  department: z.enum(['FRONTEND', 'BACKEND', 'DEVOPS', 'QA', 'FULLSTACK']).optional(),
  level: z.enum(['INTERN', 'FRESHER', 'JUNIOR', 'MIDDLE', 'SENIOR']).optional(),
  skills: z.array(z.string()).optional(),
  bioSummary: z.string().max(1000).nullable().optional(),
});
export type UpdateProfileDto = z.infer<typeof UpdateProfileSchema>;

export const UserDtoSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  fullName: z.string(),
  avatarUrl: z.string().nullable().optional(),
  role: z.enum(['ADMIN', 'PM', 'LEADER', 'MEMBER']),
  isActive: z.boolean(),
  department: z.enum(['FRONTEND', 'BACKEND', 'DEVOPS', 'QA', 'FULLSTACK']).optional(),
  level: z.enum(['INTERN', 'FRESHER', 'JUNIOR', 'MIDDLE', 'SENIOR']).optional(),
  skills: z.array(z.string()).optional(),
  bioSummary: z.string().nullable().optional(),
  team: z.object({ id: z.string(), name: z.string() }).nullable().optional(),
  permissions: z.object({
    canDecomposeProject: z.boolean(),
    canDispatch: z.boolean(),
    canApproveTask: z.boolean(),
  }).optional(),
  createdAt: z.string().or(z.date()).optional(),
});
export type UserDto = z.infer<typeof UserDtoSchema>;
export type UserResponseDto = UserDto;

export const AuthMeDtoSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  fullName: z.string(),
  avatarUrl: z.string().nullable().optional(),
  role: z.enum(['ADMIN', 'PM', 'LEADER', 'MEMBER']),
  isActive: z.boolean(),
  authVersion: z.number().int().optional(),
  department: z.enum(['FRONTEND', 'BACKEND', 'DEVOPS', 'QA', 'FULLSTACK']).optional(),
  level: z.enum(['INTERN', 'FRESHER', 'JUNIOR', 'MIDDLE', 'SENIOR']).optional(),
  skills: z.array(z.string()).optional(),
  bioSummary: z.string().nullable().optional(),
  profileRevision: z.number().optional(),
  embeddingRevision: z.number().optional(),
  isEmbeddingStale: z.boolean().optional(),
  team: z.object({ id: z.string(), name: z.string() }).nullable().optional(),
  permissions: z.object({
    canDecomposeProject: z.boolean(),
    canDispatch: z.boolean(),
    canApproveTask: z.boolean(),
  }).optional(),
  createdAt: z.string().or(z.date()).optional(),
});
export type AuthMeDto = z.infer<typeof AuthMeDtoSchema>;

// ==========================================
// 4. ENTITY RESPONSES
// ==========================================
export interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
}

export interface UserTalentProfileResponse {
  userId: string;
  department: Department;
  level: Level;
  skills: string[];
  bioSummary?: string | null;
  profileRevision?: number;
  embeddingRevision?: number;
  isEmbeddingStale?: boolean;
  lastEmbeddedAt?: string | null;
  updatedAt: string;
}

export interface UserResponse {
  id: string;
  email: string;
  fullName: string;
  avatarUrl?: string | null;
  role: Role;
  isActive: boolean;
  department?: Department;
  level?: Level;
  skills?: string[];
  bioSummary?: string | null;
  talentProfile?: UserTalentProfileResponse | null;
  createdAt: string;
  updatedAt: string;
}

export interface TeamMemberResponse {
  id: string;
  teamId: string;
  userId: string;
  joinedAt: string;
  leftAt?: string | null;
  user?: UserResponse;
}

export interface TeamResponse {
  id: string;
  name: string;
  description?: string | null;
  leaderId?: string | null;
  isActive?: boolean;
  leader?: UserResponse | null;
  memberships?: TeamMemberResponse[];
  members?: UserResponse[];
  createdAt: string;
  updatedAt: string;
}

export interface ProjectResponse {
  id: string;
  teamId: string;
  ownerId: string;
  name: string;
  description: string;
  techStack: string[];
  requiredSkills?: string[];
  complexity: Complexity;
  startDate?: string;
  targetEndDate?: string;
  status: ProjectStatus;
  archivedAt?: string | null;
  team?: TeamResponse | null;
  owner?: UserResponse | null;
  tasks?: TaskResponse[];
  createdAt: string;
  updatedAt: string;
}

export interface TaskResponse {
  id: string;
  projectId: string;
  parentTaskId?: string | null;
  assignedTo?: string | null;
  title: string;
  description?: string | null;
  targetDepartment?: Department;
  requiredLevel?: Level;
  estimatedHours?: number;
  priority: TaskPriority;
  scheduledFor?: string | null;
  status: TaskStatus;
  checklist?: ChecklistItem[] | null;
  isPotentialBlocker?: boolean;
  isBlocked?: boolean;
  blockReason?: string | null;
  blockedAt?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  earlyStartHours?: number | null;
  earlyFinishHours?: number | null;
  lateStartHours?: number | null;
  lateFinishHours?: number | null;
  slackHours?: number | null;
  isCriticalPath?: boolean;
  assignee?: UserResponse | null;
  statusHistories?: TaskStatusHistoryResponse[];
  createdAt: string;
  updatedAt: string;
}

export interface TaskStatusHistoryResponse {
  id: string;
  taskId: string;
  changedBy?: string | null;
  fromStatus: string;
  toStatus: string;
  durationInPreviousStatusHours?: number | null;
  createdAt: string;
  changer?: UserResponse | null;
}

export interface UserSkillRatingResponse {
  id: string;
  userId: string;
  skillName: string;
  ratingScore: number;
  tasksCompleted: number;
  tasksRejected: number;
  updatedAt: string;
  user?: UserResponse | null;
}

export interface CycleTimeMetrics {
  sampleCount: number;
  minHours: number;
  maxHours: number;
  medianHours: number;
  q1Hours: number;
  q3Hours: number;
  iqrHours: number;
  averageHours: number;
}

// Re-export Retrieval & Candidate Ranking Types (MOD-03)
export * from './retrieval.types';
export * from './dispatch.types';
export * from './kanban.types';
export * from './elo.types';
export * from './git.types';
export * from './rescheduling.types';

