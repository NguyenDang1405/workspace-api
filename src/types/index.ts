export type Role = 'ADMIN' | 'PM' | 'LEADER' | 'MEMBER';
export type Department = 'FRONTEND' | 'BACKEND' | 'DEVOPS' | 'QA' | 'FULLSTACK';
export type Level = 'INTERN' | 'FRESHER' | 'JUNIOR' | 'MIDDLE' | 'SENIOR';
export type Complexity = 'EASY' | 'MEDIUM' | 'HARD';
export type ProjectStatus = 'PLANNING' | 'IN_PROGRESS' | 'COMPLETED';
export type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
export type TaskStatus = 'TODO' | 'IN_PROGRESS' | 'REVIEW' | 'DONE';

export interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
}

export interface UserResponse {
  id: string;
  teamId?: string | null;
  email: string;
  fullName: string;
  avatarUrl?: string | null;
  role: Role;
  department: Department;
  level: Level;
  skills: string[];
  bioSummary?: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TeamResponse {
  id: string;
  name: string;
  description?: string | null;
  leaderId?: string | null;
  leader?: UserResponse | null;
  members?: UserResponse[];
  createdAt: string;
  updatedAt: string;
}

export interface ProjectResponse {
  id: string;
  assignedTeamId?: string | null;
  createdBy: string;
  name: string;
  description?: string | null;
  requiredSkills: string[];
  complexity: Complexity;
  status: ProjectStatus;
  assignedTeam?: TeamResponse | null;
  creator?: UserResponse;
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
  priority: TaskPriority;
  status: TaskStatus;
  requiredLevel?: string | null;
  checklist?: ChecklistItem[] | null;
  assignee?: UserResponse | null;
  createdAt: string;
  updatedAt: string;
}
