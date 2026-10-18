# AI SPECIFICATION PROMPT: DATABASE & PRISMA SCHEMA EXPANSION (10 MODULES)

> **Mục tiêu:** Cập nhật và đồng bộ toàn diện cơ sở dữ liệu vật lý (`init.sql`) và lược đồ ORM (`prisma/schema.prisma`) để hỗ trợ đầy đủ hệ sinh thái 10 mô-đun: từ tiếp nhận tài liệu đặc tả (MOD-10), đồ thị DAG (MOD-02), tìm kiếm lai (MOD-03), điều phối thích ứng (MOD-04), quan trắc dòng chảy (MOD-05), điểm Elo (MOD-06), tích hợp Git PR (MOD-07), tái lập lịch động (MOD-08) đến báo cáo Standup (MOD-09).
> **Nguyên tắc kỹ thuật:** Đảm bảo toàn vẹn dữ liệu quan hệ (ACID), bảo toàn các chỉ mục chuyên sâu (`pgvector` HNSW, GIN Full-text), ánh xạ chính xác 1:1 giữa PostgreSQL (snake_case) và Prisma (camelCase qua `@map`).

---

## 1. PHẠM VI TỆP TIN CẦN CAN THIỆP

AI Assistant cần đọc và cập nhật trực tiếp vào 2 tệp tin cốt lõi:

1. `init.sql`: Chứa kịch bản DDL PostgreSQL 16 hoàn chỉnh phục vụ khởi chạy Docker Container.
2. `prisma/schema.prisma`: Chứa toàn bộ Data Models, Enums, và Relations của Prisma Client.

---

## 2. NỘI DUNG CẬP NHẬT CƠ SỞ DỮ LIỆU DDL (`init.sql`)

Yêu cầu thay thế hoặc bổ sung vào `init.sql` toàn bộ cấu trúc DDL chuẩn hóa dưới đây (bao gồm các bảng mở rộng cho Git, Rescheduling, Standup, Task History và Elo Rating):

```sql
-- ============================================================================
-- PHẦN 1: KHỞI TẠO EXTENSIONS
-- ============================================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS vector;

-- ============================================================================
-- PHẦN 2: CÁC BẢNG LÕI HỆ THỐNG & NHÂN SỰ (MOD-01, MOD-03)
-- ============================================================================
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email CITEXT NOT NULL UNIQUE,
    hashed_password TEXT NOT NULL,
    full_name VARCHAR(100) NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'MEMBER',
    is_active BOOLEAN NOT NULL DEFAULT true,
    auth_version INTEGER NOT NULL DEFAULT 1 CHECK (auth_version > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT chk_users_role CHECK (role IN ('ADMIN', 'PM', 'LEADER', 'MEMBER')),
    CONSTRAINT chk_users_full_name CHECK (char_length(btrim(full_name)) BETWEEN 1 AND 100)
);

CREATE TABLE IF NOT EXISTS user_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token_family_id UUID NOT NULL DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    refresh_token_hash TEXT NOT NULL UNIQUE,
    device_info VARCHAR(255),
    ip_address INET,
    revoked_at TIMESTAMPTZ,
    revoke_reason VARCHAR(50),
    replaced_by_token_id UUID REFERENCES user_tokens(id) ON DELETE SET NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT chk_token_hash_not_blank CHECK (length(btrim(refresh_token_hash)) > 0),
    CONSTRAINT chk_token_expiry CHECK (expires_at > created_at)
);

CREATE TABLE IF NOT EXISTS user_talent_profiles (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    department VARCHAR(50) NOT NULL,
    level VARCHAR(20) NOT NULL,
    skills TEXT[] NOT NULL DEFAULT '{}',
    bio_summary TEXT,
    skill_embedding VECTOR(1536),
    profile_revision BIGINT NOT NULL DEFAULT 1 CHECK (profile_revision > 0),
    embedding_revision BIGINT NOT NULL DEFAULT 0 CHECK (embedding_revision >= 0),
    last_embedded_at TIMESTAMPTZ,
    is_embedding_stale BOOLEAN GENERATED ALWAYS AS (embedding_revision < profile_revision) STORED,
    search_vector TSVECTOR GENERATED ALWAYS AS (
        setweight(to_tsvector('simple', coalesce(department, '')), 'A') ||
        setweight(to_tsvector('simple', array_to_string(skills, ' ')), 'A') ||
        setweight(to_tsvector('simple', coalesce(bio_summary, '')), 'B')
    ) STORED,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT chk_talent_department CHECK (department IN ('FRONTEND', 'BACKEND', 'DEVOPS', 'QA', 'FULLSTACK')),
    CONSTRAINT chk_talent_level CHECK (level IN ('INTERN', 'FRESHER', 'JUNIOR', 'MIDDLE', 'SENIOR')),
    CONSTRAINT chk_talent_bio_len CHECK (bio_summary IS NULL OR char_length(bio_summary) <= 1000)
);

-- ============================================================================
-- PHẦN 3: DỰ ÁN & TIẾP NHẬN TÀI LIỆU (MOD-02, MOD-10)
-- ============================================================================
CREATE TABLE IF NOT EXISTS projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(200) NOT NULL,
    description TEXT NOT NULL,
    tech_stack TEXT[] NOT NULL DEFAULT '{}',
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    source_document_url TEXT,
    document_parsed_summary JSONB,
    start_date DATE NOT NULL DEFAULT CURRENT_DATE,
    target_end_date DATE NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT chk_projects_dates CHECK (target_end_date >= start_date),
    CONSTRAINT chk_projects_status CHECK (status IN ('PLANNING', 'ACTIVE', 'COMPLETED', 'ARCHIVED'))
);

-- ============================================================================
-- PHẦN 4: ĐỒ THỊ TÁC VỤ DAG & KANBAN (MOD-02, MOD-04, MOD-05)
-- ============================================================================
CREATE TABLE IF NOT EXISTS tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    target_department VARCHAR(50) NOT NULL,
    required_level VARCHAR(20) NOT NULL,
    estimated_hours NUMERIC(4, 1) NOT NULL DEFAULT 4.0,
    status VARCHAR(20) NOT NULL DEFAULT 'SCHEDULED',
    assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
    checklist JSONB NOT NULL DEFAULT '[]'::jsonb,
    
    -- Tham số Đường găng (CPM)
    early_start NUMERIC(5, 1) DEFAULT 0.0,
    early_finish NUMERIC(5, 1) DEFAULT 0.0,
    late_start NUMERIC(5, 1) DEFAULT 0.0,
    late_finish NUMERIC(5, 1) DEFAULT 0.0,
    slack_time NUMERIC(5, 1) DEFAULT 0.0,
    is_critical_path BOOLEAN NOT NULL DEFAULT false,
    
    -- Tham số Quan trắc luồng việc (MOD-05 & MOD-08)
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    is_blocked BOOLEAN NOT NULL DEFAULT false,
    block_reason VARCHAR(255),
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT chk_tasks_status CHECK (status IN ('SCHEDULED', 'TODO', 'IN_PROGRESS', 'REVIEW', 'DONE')),
    CONSTRAINT chk_tasks_department CHECK (target_department IN ('FRONTEND', 'BACKEND', 'DEVOPS', 'QA', 'FULLSTACK')),
    CONSTRAINT chk_tasks_level CHECK (required_level IN ('INTERN', 'FRESHER', 'JUNIOR', 'MIDDLE', 'SENIOR')),
    CONSTRAINT chk_tasks_hours CHECK (estimated_hours > 0)
);

CREATE TABLE IF NOT EXISTS task_dependencies (
    predecessor_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    successor_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    dependency_type VARCHAR(10) NOT NULL DEFAULT 'FS',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (predecessor_id, successor_id),
    CONSTRAINT chk_no_self_dep CHECK (predecessor_id <> successor_id)
);

-- ============================================================================
-- PHẦN 5: CÁC MODULE MỞ RỘNG MỚI (MOD-06, MOD-07, MOD-08, MOD-09)
-- ============================================================================

-- Bảng tích hợp Git Webhook & AI Verify PR (MOD-07)
CREATE TABLE IF NOT EXISTS git_pull_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    pr_number INT NOT NULL,
    pr_url TEXT NOT NULL,
    branch_name VARCHAR(100) NOT NULL,
    author_github_username VARCHAR(100) NOT NULL,
    diff_summary TEXT,
    ai_verification_feedback TEXT,
    is_verified_by_ai BOOLEAN NOT NULL DEFAULT false,
    status VARCHAR(20) NOT NULL DEFAULT 'OPEN',
    merged_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT chk_git_pr_status CHECK (status IN ('OPEN', 'MERGED', 'CLOSED'))
);

-- Bảng Nhật ký Tái lập lịch động & Mô phỏng rủi ro (MOD-08)
CREATE TABLE IF NOT EXISTS rescheduling_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    trigger_task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
    reason VARCHAR(100) NOT NULL,
    original_makespan_days NUMERIC(4, 1) NOT NULL,
    new_makespan_days NUMERIC(4, 1) NOT NULL,
    mitigation_strategy JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Bảng Báo cáo Daily Standup tự động (MOD-09)
CREATE TABLE IF NOT EXISTS daily_standup_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    report_date DATE NOT NULL DEFAULT CURRENT_DATE,
    summary_yesterday TEXT NOT NULL,
    plan_today TEXT NOT NULL,
    identified_blockers TEXT NOT NULL,
    flow_metrics JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT uq_project_standup_date UNIQUE (project_id, report_date)
);

-- Bảng Điểm năng lực thích ứng Elo (MOD-06)
CREATE TABLE IF NOT EXISTS user_skill_ratings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    skill_name VARCHAR(50) NOT NULL,
    rating_score NUMERIC(6, 2) NOT NULL DEFAULT 1200.00,
    tasks_completed INT NOT NULL DEFAULT 0,
    tasks_rejected INT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT uq_user_skill UNIQUE (user_id, skill_name),
    CONSTRAINT chk_skill_name_not_blank CHECK (length(btrim(skill_name)) > 0)
);

-- Bảng Nhật ký Lịch sử chuyển trạng thái Task (MOD-05 / IQR & Little's Law)
CREATE TABLE IF NOT EXISTS task_status_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    changed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    from_status VARCHAR(20) NOT NULL,
    to_status VARCHAR(20) NOT NULL,
    duration_in_previous_status_hours NUMERIC(7, 2),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Bảng Nhật ký Kiểm toán Hồ sơ năng lực (MOD-01)
CREATE TABLE IF NOT EXISTS talent_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subject_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    changed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    action_type VARCHAR(50) NOT NULL,
    old_data JSONB,
    new_data JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT chk_audit_action_not_blank CHECK (length(btrim(action_type)) > 0)
);

-- ============================================================================
-- PHẦN 6: CHỈ MỤC TỐI ƯU HÓA TRUY VẤN
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_user_tokens_active ON user_tokens (user_id, expires_at DESC) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_talent_embedding_hnsw ON user_talent_profiles USING hnsw (skill_embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64) WHERE skill_embedding IS NOT NULL AND embedding_revision = profile_revision;
CREATE INDEX IF NOT EXISTS idx_talent_fts_gin ON user_talent_profiles USING gin (search_vector);
CREATE INDEX IF NOT EXISTS idx_tasks_dispatch ON tasks(project_id, status) WHERE status = 'SCHEDULED';
CREATE INDEX IF NOT EXISTS idx_tasks_kanban ON tasks(assigned_to, status);
CREATE INDEX IF NOT EXISTS idx_task_deps_succ ON task_dependencies(successor_id);
CREATE INDEX IF NOT EXISTS idx_task_deps_pred ON task_dependencies(predecessor_id);
CREATE INDEX IF NOT EXISTS idx_git_pr_task ON git_pull_requests(task_id, status);
CREATE INDEX IF NOT EXISTS idx_user_skills ON user_skill_ratings(user_id, skill_name);
CREATE INDEX IF NOT EXISTS idx_task_history_lookup ON task_status_history(task_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_talent_audit_lookup ON talent_audit_logs(subject_user_id, created_at DESC);

-- ============================================================================
-- PHẦN 7: HÀM & TRIGGER TỰ ĐỘNG HÓA
-- ============================================================================
CREATE OR REPLACE FUNCTION app_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION app_bump_auth_version()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.role IS DISTINCT FROM NEW.role OR OLD.is_active IS DISTINCT FROM NEW.is_active THEN
        NEW.auth_version = OLD.auth_version + 1;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION app_bump_profile_revision()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.department IS DISTINCT FROM NEW.department
       OR OLD.level IS DISTINCT FROM NEW.level
       OR OLD.skills IS DISTINCT FROM NEW.skills
       OR OLD.bio_summary IS DISTINCT FROM NEW.bio_summary THEN
        NEW.profile_revision = OLD.profile_revision + 1;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION app_audit_talent_profile()
RETURNS TRIGGER AS $$
DECLARE
    actor_id UUID;
BEGIN
    IF OLD.department IS NOT DISTINCT FROM NEW.department
       AND OLD.level IS NOT DISTINCT FROM NEW.level
       AND OLD.skills IS NOT DISTINCT FROM NEW.skills
       AND OLD.bio_summary IS NOT DISTINCT FROM NEW.bio_summary THEN
        RETURN NEW;
    END IF;

    actor_id := NULLIF(current_setting('app.actor_id', true), '')::UUID;
    INSERT INTO talent_audit_logs (subject_user_id, changed_by, action_type, old_data, new_data)
    VALUES (NEW.user_id, actor_id, 'PROFILE_UPDATED', to_jsonb(OLD), to_jsonb(NEW));
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS a_users_auth_version ON users;
CREATE TRIGGER a_users_auth_version BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION app_bump_auth_version();

DROP TRIGGER IF EXISTS z_users_updated_at ON users;
CREATE TRIGGER z_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION app_set_updated_at();

DROP TRIGGER IF EXISTS a_talent_profile_revision ON user_talent_profiles;
CREATE TRIGGER a_talent_profile_revision BEFORE UPDATE ON user_talent_profiles FOR EACH ROW EXECUTE FUNCTION app_bump_profile_revision();

DROP TRIGGER IF EXISTS z_talent_profiles_updated_at ON user_talent_profiles;
CREATE TRIGGER z_talent_profiles_updated_at BEFORE UPDATE ON user_talent_profiles FOR EACH ROW EXECUTE FUNCTION app_set_updated_at();

DROP TRIGGER IF EXISTS zz_talent_profiles_audit ON user_talent_profiles;
CREATE TRIGGER zz_talent_profiles_audit AFTER UPDATE OF department, level, skills, bio_summary ON user_talent_profiles FOR EACH ROW EXECUTE FUNCTION app_audit_talent_profile();

DROP TRIGGER IF EXISTS z_projects_updated_at ON projects;
CREATE TRIGGER z_projects_updated_at BEFORE UPDATE ON projects FOR EACH ROW EXECUTE FUNCTION app_set_updated_at();

DROP TRIGGER IF EXISTS z_tasks_updated_at ON tasks;
CREATE TRIGGER z_tasks_updated_at BEFORE UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION app_set_updated_at();

DROP TRIGGER IF EXISTS z_user_skill_ratings_updated_at ON user_skill_ratings;
CREATE TRIGGER z_user_skill_ratings_updated_at BEFORE UPDATE ON user_skill_ratings FOR EACH ROW EXECUTE FUNCTION app_set_updated_at();

```

---

## 3. NỘI DUNG LƯỢC ĐỒ PRISMA TOÀN DIỆN (`prisma/schema.prisma`)

Yêu cầu thay thế toàn bộ file `prisma/schema.prisma` bằng nội dung chuẩn hóa khớp $100\%$ với DDL trên:

```prisma
generator client {
  provider        = "prisma-client-js"
  previewFeatures = ["postgresqlExtensions"]
}

datasource db {
  provider   = "postgresql"
  url        = env("DATABASE_URL")
  extensions = [pgcrypto, citext, vector]
}

enum Role {
  ADMIN
  PM
  LEADER
  MEMBER
}

enum Department {
  FRONTEND
  BACKEND
  DEVOPS
  QA
  FULLSTACK
}

enum Level {
  INTERN
  FRESHER
  JUNIOR
  MIDDLE
  SENIOR
}

enum ProjectStatus {
  PLANNING
  ACTIVE
  COMPLETED
  ARCHIVED
}

enum TaskStatus {
  SCHEDULED
  TODO
  IN_PROGRESS
  REVIEW
  DONE
}

model User {
  id             String             @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  email          String             @unique @db.Citext
  hashedPassword String             @map("hashed_password")
  fullName       String             @map("full_name") @db.VarChar(100)
  role           Role               @default(MEMBER)
  isActive       Boolean            @default(true) @map("is_active")
  authVersion    Int                @default(1) @map("auth_version")
  createdAt      DateTime           @default(now()) @map("created_at") @db.Timestamptz
  updatedAt      DateTime           @default(now()) @updatedAt @map("updated_at") @db.Timestamptz

  tokens         UserToken[]
  talentProfile  UserTalentProfile?
  ownedProjects  Project[]          @relation("ProjectOwner")
  assignedTasks  Task[]             @relation("AssignedTasks")
  statusHistory  TaskStatusHistory[]
  skillRatings   UserSkillRating[]
  auditSubject   TalentAuditLog[]   @relation("AuditSubject")
  auditActor     TalentAuditLog[]   @relation("AuditActor")

  @@map("users")
}

model UserToken {
  id                String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tokenFamilyId     String    @default(dbgenerated("gen_random_uuid()")) @map("token_family_id") @db.Uuid
  userId            String    @map("user_id") @db.Uuid
  refreshTokenHash  String    @unique @map("refresh_token_hash")
  deviceInfo        String?   @map("device_info") @db.VarChar(255)
  ipAddress         String?   @map("ip_address") @db.Inet
  revokedAt         DateTime? @map("revoked_at") @db.Timestamptz
  revokeReason      String?   @map("revoke_reason") @db.VarChar(50)
  replacedByTokenId String?   @map("replaced_by_token_id") @db.Uuid
  expiresAt         DateTime  @map("expires_at") @db.Timestamptz
  createdAt         DateTime  @default(now()) @map("created_at") @db.Timestamptz

  user              User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, expiresAt(sort: Desc)])
  @@map("user_tokens")
}

model UserTalentProfile {
  userId               String                       @id @map("user_id") @db.Uuid
  department           Department                   @default(BACKEND)
  level                Level                        @default(FRESHER)
  skills               String[]                     @default([])
  bioSummary           String?                      @map("bio_summary")
  skillEmbedding       Unsupported("vector(1536)")? @map("skill_embedding")
  profileRevision      BigInt                       @default(1) @map("profile_revision")
  embeddingRevision    BigInt                       @default(0) @map("embedding_revision")
  lastEmbeddedAt       DateTime?                    @map("last_embedded_at") @db.Timestamptz
  isEmbeddingStale     Boolean                      @default(true) @map("is_embedding_stale")
  searchVector         Unsupported("tsvector")?     @map("search_vector")
  updatedAt            DateTime                     @default(now()) @updatedAt @map("updated_at") @db.Timestamptz

  user                 User                         @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("user_talent_profiles")
}

model Project {
  id                    String              @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  name                  String              @db.VarChar(200)
  description           String
  techStack             String[]            @default([]) @map("tech_stack")
  ownerId               String              @map("owner_id") @db.Uuid
  sourceDocumentUrl     String?             @map("source_document_url")
  documentParsedSummary Json?               @map("document_parsed_summary")
  startDate             DateTime            @default(now()) @map("start_date") @db.Date
  targetEndDate         DateTime            @map("target_end_date") @db.Date
  status                ProjectStatus       @default(ACTIVE)
  createdAt             DateTime            @default(now()) @map("created_at") @db.Timestamptz
  updatedAt             DateTime            @default(now()) @updatedAt @map("updated_at") @db.Timestamptz

  owner                 User                @relation("ProjectOwner", fields: [ownerId], references: [id], onDelete: Restrict)
  tasks                 Task[]
  reschedulingEvents    ReschedulingEvent[]
  standupReports        DailyStandupReport[]

  @@map("projects")
}

model Task {
  id                   String              @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  projectId            String              @map("project_id") @db.Uuid
  title                String              @db.VarChar(255)
  description          String
  targetDepartment     Department          @map("target_department")
  requiredLevel        Level               @map("required_level")
  estimatedHours       Decimal             @default(4.0) @map("estimated_hours") @db.Decimal(4, 1)
  status               TaskStatus          @default(SCHEDULED)
  assignedTo           String?             @map("assigned_to") @db.Uuid
  checklist            Json                @default("[]")
  
  earlyStart           Decimal             @default(0.0) @map("early_start") @db.Decimal(5, 1)
  earlyFinish          Decimal             @default(0.0) @map("early_finish") @db.Decimal(5, 1)
  lateStart            Decimal             @default(0.0) @map("late_start") @db.Decimal(5, 1)
  lateFinish           Decimal             @default(0.0) @map("late_finish") @db.Decimal(5, 1)
  slackTime            Decimal             @default(0.0) @map("slack_time") @db.Decimal(5, 1)
  isCriticalPath       Boolean             @default(false) @map("is_critical_path")
  
  startedAt            DateTime?           @map("started_at") @db.Timestamptz
  completedAt          DateTime?           @map("completed_at") @db.Timestamptz
  isBlocked            Boolean             @default(false) @map("is_blocked")
  blockReason          String?             @map("block_reason") @db.VarChar(255)
  
  createdAt            DateTime            @default(now()) @map("created_at") @db.Timestamptz
  updatedAt            DateTime            @default(now()) @updatedAt @map("updated_at") @db.Timestamptz

  project              Project             @relation(fields: [projectId], references: [id], onDelete: Cascade)
  assignee             User?               @relation("AssignedTasks", fields: [assignedTo], references: [id], onDelete: SetNull)
  dependencies         TaskDependency[]    @relation("SuccessorTasks")
  dependents           TaskDependency[]    @relation("PredecessorTasks")
  gitPRs               GitPullRequest[]
  statusHistory        TaskStatusHistory[]
  triggeredReschedules ReschedulingEvent[]

  @@index([projectId, status], map: "idx_tasks_dispatch")
  @@index([assignedTo, status], map: "idx_tasks_kanban")
  @@map("tasks")
}

model TaskDependency {
  predecessorId  String   @map("predecessor_id") @db.Uuid
  successorId    String   @map("successor_id") @db.Uuid
  dependencyType String   @default("FS") @map("dependency_type") @db.VarChar(10)
  createdAt      DateTime @default(now()) @map("created_at") @db.Timestamptz

  predecessor    Task     @relation("PredecessorTasks", fields: [predecessorId], references: [id], onDelete: Cascade)
  successor      Task     @relation("SuccessorTasks", fields: [successorId], references: [id], onDelete: Cascade)

  @@id([predecessorId, successorId])
  @@index([successorId], map: "idx_task_deps_succ")
  @@index([predecessorId], map: "idx_task_deps_pred")
  @@map("task_dependencies")
}

model GitPullRequest {
  id                    String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  taskId                String    @map("task_id") @db.Uuid
  prNumber              Int       @map("pr_number")
  prUrl                 String    @map("pr_url")
  branchName            String    @map("branch_name") @db.VarChar(100)
  authorGithubUsername  String    @map("author_github_username") @db.VarChar(100)
  diffSummary           String?   @map("diff_summary")
  aiVerificationFeedback String?  @map("ai_verification_feedback")
  isVerifiedByAi        Boolean   @default(false) @map("is_verified_by_ai")
  status                String    @default("OPEN") @db.VarChar(20)
  mergedAt              DateTime? @map("merged_at") @db.Timestamptz
  createdAt             DateTime  @default(now()) @map("created_at") @db.Timestamptz

  task                  Task      @relation(fields: [taskId], references: [id], onDelete: Cascade)

  @@index([taskId, status], map: "idx_git_pr_task")
  @@map("git_pull_requests")
}

model ReschedulingEvent {
  id                   String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  projectId            String   @map("project_id") @db.Uuid
  triggerTaskId        String?  @map("trigger_task_id") @db.Uuid
  reason               String   @db.VarChar(100)
  originalMakespanDays Decimal  @map("original_makespan_days") @db.Decimal(4, 1)
  newMakespanDays      Decimal  @map("new_makespan_days") @db.Decimal(4, 1)
  mitigationStrategy   Json?    @map("mitigation_strategy")
  createdAt            DateTime @default(now()) @map("created_at") @db.Timestamptz

  project              Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  triggerTask          Task?    @relation(fields: [triggerTaskId], references: [id], onDelete: SetNull)

  @@map("rescheduling_events")
}

model DailyStandupReport {
  id                 String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  projectId          String   @map("project_id") @db.Uuid
  reportDate         DateTime @default(now()) @map("report_date") @db.Date
  summaryYesterday   String   @map("summary_yesterday")
  planToday          String   @map("plan_today")
  identifiedBlockers String   @map("identified_blockers")
  flowMetrics        Json?    @map("flow_metrics")
  createdAt          DateTime @default(now()) @map("created_at") @db.Timestamptz

  project            Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)

  @@unique([projectId, reportDate], map: "uq_project_standup_date")
  @@map("daily_standup_reports")
}

model UserSkillRating {
  id             String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  userId         String   @map("user_id") @db.Uuid
  skillName      String   @map("skill_name") @db.VarChar(50)
  ratingScore    Decimal  @default(1200.00) @map("rating_score") @db.Decimal(6, 2)
  tasksCompleted Int      @default(0) @map("tasks_completed")
  tasksRejected  Int      @default(0) @map("tasks_rejected")
  updatedAt      DateTime @default(now()) @updatedAt @map("updated_at") @db.Timestamptz

  user           User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, skillName], map: "uq_user_skill")
  @@index([userId, skillName], map: "idx_user_skills")
  @@map("user_skill_ratings")
}

model TaskStatusHistory {
  id                            String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  taskId                        String   @map("task_id") @db.Uuid
  changedBy                     String?  @map("changed_by") @db.Uuid
  fromStatus                    String   @map("from_status") @db.VarChar(20)
  toStatus                      String   @map("to_status") @db.VarChar(20)
  durationInPreviousStatusHours Decimal? @map("duration_in_previous_status_hours") @db.Decimal(7, 2)
  createdAt                     DateTime @default(now()) @map("created_at") @db.Timestamptz

  task                          Task     @relation(fields: [taskId], references: [id], onDelete: Cascade)
  actor                         User?    @relation(fields: [changedBy], references: [id], onDelete: SetNull)

  @@index([taskId, createdAt(sort: Desc)], map: "idx_task_history_lookup")
  @@map("task_status_history")
}

model TalentAuditLog {
  id            String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  subjectUserId String?  @map("subject_user_id") @db.Uuid
  changedBy     String?  @map("changed_by") @db.Uuid
  actionType    String   @map("action_type") @db.VarChar(50)
  oldData       Json?    @map("old_data")
  newData       Json?    @map("new_data")
  createdAt     DateTime @default(now()) @map("created_at") @db.Timestamptz

  subjectUser   User?    @relation("AuditSubject", fields: [subjectUserId], references: [id], onDelete: SetNull)
  actor         User?    @relation("AuditActor", fields: [changedBy], references: [id], onDelete: SetNull)

  @@index([subjectUserId, createdAt(sort: Desc)], map: "idx_talent_audit_lookup")
  @@map("talent_audit_logs")
}

```

---

## 4. QUY TRÌNH THỰC THI & KIỂM TRA ĐỒNG BỘ (EXECUTION STEPS)

Khi tiến hành cập nhật hệ thống, AI Assistant hoặc Developer cần tuân thủ đúng 3 bước:

1. **Khởi động lại CSDL PostgreSQL mới hoàn toàn từ `init.sql`:**
```bash
docker compose down -v
docker compose up -d

```


2. **Kiểm tra trạng thái bảng trong container Docker:**
```bash
docker exec -it smart_workspace_postgres psql -U postgres -d workspace_db -c "\dt"

```


*(Kết quả phải hiển thị đủ 11 bảng quan hệ).*
3. **Sinh lại Prisma Client:**
```bash
npx prisma generate

```


4. **Kiểm tra lỗi kiểu dữ liệu toàn dự án:**
```bash
npx tsc --noEmit

```



---
