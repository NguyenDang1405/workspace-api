export type Role = 'ADMIN' | 'PM' | 'LEADER' | 'MEMBER';
export type Department = 'FRONTEND' | 'BACKEND' | 'DEVOPS' | 'QA' | 'FULLSTACK';
export type Level = 'INTERN' | 'FRESHER' | 'JUNIOR' | 'MIDDLE' | 'SENIOR';
export type Complexity = 'EASY' | 'MEDIUM' | 'HARD';
export type ProjectStatus = 'PLANNING' | 'ACTIVE' | 'COMPLETED' | 'ARCHIVED';
export type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
export type TaskStatus = 'SCHEDULED' | 'TODO' | 'IN_PROGRESS' | 'REVIEW' | 'DONE';
export type DispatchRunStatus = 'PREVIEW' | 'APPROVED' | 'CANCELLED';
export type SkillOutcome = 'ACCEPTED' | 'REJECTED' | 'OVERDUE';

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
