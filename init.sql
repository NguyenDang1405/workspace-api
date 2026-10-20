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
    avatar_url TEXT,
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
-- PHẦN 3: ĐỘI NGŨ & DỰ ÁN (MOD-02, MOD-10, TEAMS)
-- ============================================================================
CREATE TABLE IF NOT EXISTS teams (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL UNIQUE,
    description TEXT,
    leader_id UUID REFERENCES users(id) ON DELETE SET NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS team_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    left_at TIMESTAMPTZ,

    CONSTRAINT uq_team_members_active_membership UNIQUE (team_id, user_id)
);

CREATE TABLE IF NOT EXISTS projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    name VARCHAR(200) NOT NULL,
    description TEXT NOT NULL,
    tech_stack TEXT[] NOT NULL DEFAULT '{}',
    complexity VARCHAR(20) NOT NULL DEFAULT 'MEDIUM',
    source_document_url TEXT,
    document_parsed_summary JSONB,
    start_date DATE NOT NULL DEFAULT CURRENT_DATE,
    target_end_date DATE NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT chk_projects_complexity CHECK (complexity IN ('EASY', 'MEDIUM', 'HARD')),
    CONSTRAINT chk_projects_dates CHECK (target_end_date >= start_date),
    CONSTRAINT chk_projects_status CHECK (status IN ('PLANNING', 'ACTIVE', 'COMPLETED', 'ARCHIVED'))
);

-- Bảng Tài liệu Dự án & RAG SRS Chunking (MOD-10)
CREATE TABLE IF NOT EXISTS project_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    file_name VARCHAR(255) NOT NULL,
    file_url TEXT NOT NULL,
    raw_content TEXT,
    extracted_stories JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- PHẦN 4: ĐỒ THỊ TÁC VỤ DAG & KANBAN (MOD-02, MOD-03, MOD-04, MOD-05, MOD-08)
-- ============================================================================
CREATE TABLE IF NOT EXISTS tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    parent_task_id UUID REFERENCES tasks(id) ON DELETE CASCADE,
    assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    priority VARCHAR(20) NOT NULL DEFAULT 'MEDIUM',
    target_department VARCHAR(50) NOT NULL DEFAULT 'FULLSTACK',
    required_level VARCHAR(20) NOT NULL DEFAULT 'JUNIOR',
    estimated_hours NUMERIC(4, 1) NOT NULL DEFAULT 4.0,
    actual_hours NUMERIC(5, 2),
    status VARCHAR(20) NOT NULL DEFAULT 'SCHEDULED',
    checklist JSONB NOT NULL DEFAULT '[]'::jsonb,
    
    -- Véc-tơ ngữ nghĩa Task (MOD-03, MOD-04 HNSW)
    task_embedding VECTOR(1536),
    
    -- Tham số Đường găng (CPM) (MOD-02)
    early_start NUMERIC(5, 1) DEFAULT 0.0,
    early_finish NUMERIC(5, 1) DEFAULT 0.0,
    late_start NUMERIC(5, 1) DEFAULT 0.0,
    late_finish NUMERIC(5, 1) DEFAULT 0.0,
    slack_time NUMERIC(5, 1) DEFAULT 0.0,
    is_critical_path BOOLEAN NOT NULL DEFAULT false,
    
    -- Tham số Quan trắc luồng việc & Little's Law (MOD-05 & MOD-08)
    started_at TIMESTAMPTZ,
    in_review_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    due_date DATE,
    is_blocked BOOLEAN NOT NULL DEFAULT false,
    block_reason VARCHAR(255),
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT chk_tasks_status CHECK (status IN ('SCHEDULED', 'TODO', 'IN_PROGRESS', 'REVIEW', 'DONE')),
    CONSTRAINT chk_tasks_priority CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH', 'URGENT')),
    CONSTRAINT chk_tasks_department CHECK (target_department IN ('FRONTEND', 'BACKEND', 'DEVOPS', 'QA', 'FULLSTACK')),
    CONSTRAINT chk_tasks_level CHECK (required_level IN ('INTERN', 'FRESHER', 'JUNIOR', 'MIDDLE', 'SENIOR')),
    CONSTRAINT chk_tasks_hours CHECK (estimated_hours > 0),
    CONSTRAINT chk_tasks_actual_hours CHECK (actual_hours IS NULL OR actual_hours >= 0)
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
-- PHẦN 5: ĐIỀU PHỐI THÍCH ỨNG & THỰC NGHIỆM ĐIỀU ĐỘ (MOD-04)
-- ============================================================================
CREATE TABLE IF NOT EXISTS dispatch_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    recommended_candidates JSONB NOT NULL,
    chosen_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    is_human_override BOOLEAN NOT NULL DEFAULT false,
    override_reason TEXT,
    dispatched_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- PHẦN 6: CÁC MODULE MỞ RỘNG (MOD-06, MOD-07, MOD-08, MOD-09)
-- ============================================================================

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

-- Bảng Lưu vết Chuỗi thời gian Biến động Elo Skill Ratings (MOD-06)
CREATE TABLE IF NOT EXISTS user_skill_rating_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    skill_name VARCHAR(50) NOT NULL,
    task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
    old_rating NUMERIC(6, 2) NOT NULL,
    new_rating NUMERIC(6, 2) NOT NULL,
    delta NUMERIC(6, 2) NOT NULL,
    event_type VARCHAR(20) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT chk_skill_log_event_type CHECK (event_type IN ('TASK_DONE', 'REVIEW_REJECT')),
    CONSTRAINT chk_skill_log_name_not_blank CHECK (length(btrim(skill_name)) > 0)
);

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
-- PHẦN 7: CHỈ MỤC TỐI ƯU HÓA TRUY VẤN
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_user_tokens_active ON user_tokens (user_id, expires_at DESC) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_talent_embedding_hnsw ON user_talent_profiles USING hnsw (skill_embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64) WHERE skill_embedding IS NOT NULL AND embedding_revision = profile_revision;
CREATE INDEX IF NOT EXISTS idx_talent_fts_gin ON user_talent_profiles USING gin (search_vector);
CREATE INDEX IF NOT EXISTS idx_talent_dispatch_filter ON user_talent_profiles (department, level, user_id);

CREATE INDEX IF NOT EXISTS idx_tasks_dispatch ON tasks(project_id, status) WHERE status = 'SCHEDULED';
CREATE INDEX IF NOT EXISTS idx_tasks_kanban ON tasks(assigned_to, status);
CREATE INDEX IF NOT EXISTS idx_tasks_embedding_hnsw ON tasks USING hnsw (task_embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64) WHERE task_embedding IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_task_deps_succ ON task_dependencies(successor_id);
CREATE INDEX IF NOT EXISTS idx_task_deps_pred ON task_dependencies(predecessor_id);

CREATE INDEX IF NOT EXISTS idx_dispatch_history_task ON dispatch_history(task_id, dispatched_at DESC);
CREATE INDEX IF NOT EXISTS idx_dispatch_history_user ON dispatch_history(chosen_user_id, dispatched_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_skills ON user_skill_ratings(user_id, skill_name);
CREATE INDEX IF NOT EXISTS idx_user_skill_logs ON user_skill_rating_logs(user_id, skill_name, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_project_documents_project ON project_documents(project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_git_pr_task ON git_pull_requests(task_id, status);
CREATE INDEX IF NOT EXISTS idx_task_history_lookup ON task_status_history(task_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_talent_audit_lookup ON talent_audit_logs(subject_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_projects_team_status ON projects(team_id, status);
CREATE INDEX IF NOT EXISTS idx_team_members_active_user ON team_members(user_id, team_id);

-- ============================================================================
-- PHẦN 8: HÀM & TRIGGER TỰ ĐỘNG HÓA
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

DROP TRIGGER IF EXISTS z_teams_updated_at ON teams;
CREATE TRIGGER z_teams_updated_at BEFORE UPDATE ON teams FOR EACH ROW EXECUTE FUNCTION app_set_updated_at();

DROP TRIGGER IF EXISTS z_projects_updated_at ON projects;
CREATE TRIGGER z_projects_updated_at BEFORE UPDATE ON projects FOR EACH ROW EXECUTE FUNCTION app_set_updated_at();

DROP TRIGGER IF EXISTS z_tasks_updated_at ON tasks;
CREATE TRIGGER z_tasks_updated_at BEFORE UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION app_set_updated_at();

DROP TRIGGER IF EXISTS z_user_skill_ratings_updated_at ON user_skill_ratings;
CREATE TRIGGER z_user_skill_ratings_updated_at BEFORE UPDATE ON user_skill_ratings FOR EACH ROW EXECUTE FUNCTION app_set_updated_at();
