-- Smart Workspace: Auth & Talent schema, production-minded MVP
-- PostgreSQL 15+ and pgvector 0.5+ assumed.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE users (
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
    CONSTRAINT chk_users_full_name CHECK (
        char_length(btrim(full_name)) BETWEEN 1 AND 100
    )
);
-- Store only an opaque, one-way hash of a refresh token.  The raw token is
-- returned once to the browser in an HttpOnly, Secure cookie and is never saved.
CREATE TABLE user_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token_family_id UUID NOT NULL DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    refresh_token_hash TEXT NOT NULL UNIQUE,
    device_info VARCHAR(255),
    ip_address INET,
    revoked_at TIMESTAMPTZ,
    revoke_reason VARCHAR(50),
    replaced_by_token_id UUID REFERENCES user_tokens(id) ON DELETE
    SET NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT chk_token_hash_not_blank CHECK (length(btrim(refresh_token_hash)) > 0),
        CONSTRAINT chk_token_expiry_after_creation CHECK (expires_at > created_at),
        CONSTRAINT chk_revocation_reason CHECK (
            revoke_reason IS NULL
            OR revoke_reason IN (
                'LOGOUT',
                'ROTATED',
                'REUSE_DETECTED',
                'PASSWORD_CHANGED',
                'ACCOUNT_DISABLED',
                'ADMIN_REVOKED'
            )
        )
);
CREATE TABLE user_talent_profiles (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    department VARCHAR(50) NOT NULL,
    level VARCHAR(20) NOT NULL,
    -- This is the MVP source used for embedding and full-text search.  If the
    -- Bayesian module is enabled, migrate skills to the normalized tables below.
    skills TEXT [] NOT NULL DEFAULT '{}',
    bio_summary TEXT,
    skill_embedding VECTOR(1536),
    profile_revision BIGINT NOT NULL DEFAULT 1 CHECK (profile_revision > 0),
    embedding_revision BIGINT NOT NULL DEFAULT 0 CHECK (embedding_revision >= 0),
    embedding_content_hash CHAR(64),
    last_embedded_at TIMESTAMPTZ,
    is_embedding_stale BOOLEAN GENERATED ALWAYS AS (embedding_revision < profile_revision) STORED,
    search_vector TSVECTOR GENERATED ALWAYS AS (
        setweight(
            to_tsvector('simple', coalesce(department, '')),
            'A'
        ) || setweight(
            to_tsvector('simple', array_to_string(skills, ' ')),
            'A'
        ) || setweight(
            to_tsvector('simple', coalesce(bio_summary, '')),
            'B'
        )
    ) STORED,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_talent_department CHECK (
        department IN (
            'FRONTEND',
            'BACKEND',
            'DEVOPS',
            'QA',
            'FULLSTACK'
        )
    ),
    CONSTRAINT chk_talent_level CHECK (
        level IN (
            'INTERN',
            'FRESHER',
            'JUNIOR',
            'MIDDLE',
            'SENIOR'
        )
    ),
    CONSTRAINT chk_talent_bio_len CHECK (
        bio_summary IS NULL
        OR char_length(bio_summary) <= 1000
    ),
    CONSTRAINT chk_embedding_revision_not_ahead CHECK (embedding_revision <= profile_revision)
);
-- Audit records must survive a hard deletion.  In normal operation, deactivate
-- users instead of deleting them.
CREATE TABLE talent_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subject_user_id UUID REFERENCES users(id) ON DELETE
    SET NULL,
        changed_by UUID REFERENCES users(id) ON DELETE
    SET NULL,
        action_type VARCHAR(50) NOT NULL,
        old_data JSONB,
        new_data JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT chk_audit_action_not_blank CHECK (length(btrim(action_type)) > 0)
);
-- A UNIQUE constraint on users.email already creates its lookup index.  Do not
-- add a second, redundant index on the same column.
CREATE INDEX idx_user_tokens_active_by_user ON user_tokens (user_id, expires_at DESC)
WHERE revoked_at IS NULL;
CREATE INDEX idx_talent_embedding_hnsw_current ON user_talent_profiles USING hnsw (skill_embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64)
WHERE skill_embedding IS NOT NULL
    AND embedding_revision = profile_revision;
CREATE INDEX idx_talent_fts_gin ON user_talent_profiles USING gin (search_vector);
CREATE INDEX idx_talent_dispatch_filter ON user_talent_profiles (department, level, user_id);
CREATE INDEX idx_talent_embeddings_pending ON user_talent_profiles (updated_at)
WHERE is_embedding_stale;
CREATE INDEX idx_talent_audit_subject_time ON talent_audit_logs (subject_user_id, created_at DESC);
CREATE OR REPLACE FUNCTION app_set_updated_at() RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = CURRENT_TIMESTAMP;
RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE OR REPLACE FUNCTION app_bump_auth_version() RETURNS TRIGGER AS $$ BEGIN IF OLD.role IS DISTINCT
FROM NEW.role
    OR OLD.is_active IS DISTINCT
FROM NEW.is_active THEN NEW.auth_version = OLD.auth_version + 1;
END IF;
RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE OR REPLACE FUNCTION app_bump_profile_revision() RETURNS TRIGGER AS $$ BEGIN IF OLD.department IS DISTINCT
FROM NEW.department
    OR OLD.level IS DISTINCT
FROM NEW.level
    OR OLD.skills IS DISTINCT
FROM NEW.skills
    OR OLD.bio_summary IS DISTINCT
FROM NEW.bio_summary THEN NEW.profile_revision = OLD.profile_revision + 1;
END IF;
RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- API transactions that change a profile should set a trusted, transaction-local
-- actor id first: SET LOCAL app.actor_id = '<authenticated-user-uuid>';
CREATE OR REPLACE FUNCTION app_audit_talent_profile() RETURNS TRIGGER AS $$
DECLARE actor_id UUID;
BEGIN IF OLD.department IS NOT DISTINCT
FROM NEW.department
    AND OLD.level IS NOT DISTINCT
FROM NEW.level
    AND OLD.skills IS NOT DISTINCT
FROM NEW.skills
    AND OLD.bio_summary IS NOT DISTINCT
FROM NEW.bio_summary THEN RETURN NEW;
END IF;
actor_id := NULLIF(current_setting('app.actor_id', true), '')::UUID;
INSERT INTO talent_audit_logs (
        subject_user_id,
        changed_by,
        action_type,
        old_data,
        new_data
    )
VALUES (
        NEW.user_id,
        actor_id,
        'PROFILE_UPDATED',
        to_jsonb(OLD),
        to_jsonb(NEW)
    );
RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER a_users_auth_version BEFORE
UPDATE ON users FOR EACH ROW EXECUTE FUNCTION app_bump_auth_version();
CREATE TRIGGER z_users_updated_at BEFORE
UPDATE ON users FOR EACH ROW EXECUTE FUNCTION app_set_updated_at();
CREATE TRIGGER a_talent_profile_revision BEFORE
UPDATE ON user_talent_profiles FOR EACH ROW EXECUTE FUNCTION app_bump_profile_revision();
CREATE TRIGGER z_talent_profiles_updated_at BEFORE
UPDATE ON user_talent_profiles FOR EACH ROW EXECUTE FUNCTION app_set_updated_at();
CREATE TRIGGER zz_talent_profiles_audit
AFTER
UPDATE OF department,
    level,
    skills,
    bio_summary ON user_talent_profiles FOR EACH ROW EXECUTE FUNCTION app_audit_talent_profile();
-- Worker contract for embeddings:
-- 1. Read profile_revision and build the source text.
-- 2. Generate the embedding outside the transaction.
-- 3. Mark it current only if the source was not changed while waiting.
-- UPDATE user_talent_profiles
-- SET skill_embedding = :embedding,
--     embedding_revision = :observed_revision,
--     embedding_content_hash = :sha256,
--     last_embedded_at = CURRENT_TIMESTAMP
-- WHERE user_id = :user_id
--   AND profile_revision = :observed_revision;
-- Optional migration for the Bayesian skill model.  Do not make `skills TEXT[]`
-- and this table two independent sources of truth; migrate the array first and
-- maintain the search document in the application or a dedicated trigger.
CREATE TABLE skills (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name CITEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE user_skill_states (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    skill_id UUID NOT NULL REFERENCES skills(id) ON DELETE RESTRICT,
    declared_level SMALLINT CHECK (
        declared_level BETWEEN 0 AND 5
    ),
    belief_mean NUMERIC(5, 4) NOT NULL DEFAULT 0.5000 CHECK (
        belief_mean BETWEEN 0 AND 1
    ),
    belief_variance NUMERIC(6, 5) NOT NULL DEFAULT 0.25000 CHECK (
        belief_variance > 0
        AND belief_variance <= 1
    ),
    evidence_count INTEGER NOT NULL DEFAULT 0 CHECK (evidence_count >= 0),
    last_evaluated_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, skill_id)
);
CREATE TRIGGER z_user_skill_states_updated_at BEFORE
UPDATE ON user_skill_states FOR EACH ROW EXECUTE FUNCTION app_set_updated_at();

-- Smart Workspace: Project, DAG and dispatch schema.
-- Prerequisites: auth_talent_schema_review.sql, PostgreSQL 15+, pgvector.

CREATE TABLE teams (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name CITEXT NOT NULL UNIQUE,
    description TEXT,
    leader_id UUID REFERENCES users(id) ON DELETE RESTRICT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_team_name_not_blank CHECK (length(btrim(name::text)) > 0)
);

CREATE TABLE team_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE RESTRICT,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    left_at TIMESTAMPTZ,
    CONSTRAINT chk_team_membership_dates CHECK (left_at IS NULL OR left_at >= joined_at)
);

CREATE INDEX idx_team_members_active_user
    ON team_members (user_id, team_id) WHERE left_at IS NULL;
CREATE UNIQUE INDEX uq_team_members_active_membership
    ON team_members (team_id, user_id) WHERE left_at IS NULL;

-- Deferred so a transaction may create a team, add the leader as a member, and
-- then assign leader_id in any order before COMMIT.
CREATE OR REPLACE FUNCTION app_validate_team_leader()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.leader_id IS NULL THEN
        RETURN NULL;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM users u
        JOIN team_members tm ON tm.user_id = u.id
        WHERE tm.team_id = NEW.id
          AND tm.user_id = NEW.leader_id
          AND tm.left_at IS NULL
          AND u.is_active
          AND u.role IN ('ADMIN', 'PM', 'LEADER')
    ) THEN
        RAISE EXCEPTION 'Team leader must be an active ADMIN, PM, or LEADER in that team';
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER z_validate_team_leader
AFTER INSERT OR UPDATE OF leader_id ON teams
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION app_validate_team_leader();

CREATE OR REPLACE FUNCTION app_validate_team_leader_membership()
RETURNS TRIGGER AS $$
DECLARE
    affected_team_id UUID;
BEGIN
    IF TG_OP = 'DELETE' THEN
        affected_team_id := OLD.team_id;
    ELSE
        affected_team_id := NEW.team_id;
    END IF;
    IF EXISTS (
        SELECT 1
        FROM teams t
        WHERE t.id = affected_team_id
          AND t.leader_id IS NOT NULL
          AND NOT EXISTS (
              SELECT 1 FROM team_members tm
              WHERE tm.team_id = t.id
                AND tm.user_id = t.leader_id
                AND tm.left_at IS NULL
          )
    ) THEN
        RAISE EXCEPTION 'A team leader cannot be removed from their active team membership';
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER z_validate_team_leader_membership
AFTER INSERT OR UPDATE OR DELETE ON team_members
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION app_validate_team_leader_membership();

CREATE TABLE projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE RESTRICT,
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    name VARCHAR(200) NOT NULL,
    description TEXT NOT NULL,
    tech_stack TEXT[] NOT NULL DEFAULT '{}',
    complexity VARCHAR(20) NOT NULL DEFAULT 'MEDIUM',
    start_date DATE NOT NULL DEFAULT CURRENT_DATE,
    target_end_date DATE NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PLANNING',
    archived_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_projects_name_not_blank CHECK (length(btrim(name)) > 0),
    CONSTRAINT chk_projects_complexity CHECK (complexity IN ('EASY', 'MEDIUM', 'HARD')),
    CONSTRAINT chk_projects_dates CHECK (target_end_date >= start_date),
    CONSTRAINT chk_projects_status CHECK (status IN ('PLANNING', 'ACTIVE', 'COMPLETED', 'ARCHIVED')),
    CONSTRAINT chk_projects_archived_state CHECK (
        (status = 'ARCHIVED') = (archived_at IS NOT NULL)
    )
);

CREATE INDEX idx_projects_team_status ON projects (team_id, status);

CREATE OR REPLACE FUNCTION app_validate_project_owner()
RETURNS TRIGGER AS $$
DECLARE
    owner_role VARCHAR(20);
    owner_active BOOLEAN;
BEGIN
    SELECT role, is_active INTO owner_role, owner_active
    FROM users WHERE id = NEW.owner_id;

    IF owner_role IS NULL OR NOT owner_active
       OR owner_role NOT IN ('ADMIN', 'PM', 'LEADER') THEN
        RAISE EXCEPTION 'Project owner must be an active ADMIN, PM, or LEADER';
    END IF;

    -- A Team Leader may own only a project for an active team membership.
    IF owner_role = 'LEADER' AND NOT EXISTS (
        SELECT 1 FROM team_members
        WHERE team_id = NEW.team_id
          AND user_id = NEW.owner_id
          AND left_at IS NULL
    ) THEN
        RAISE EXCEPTION 'A Team Leader must be an active member of the project team';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER a_validate_project_owner
BEFORE INSERT OR UPDATE OF owner_id, team_id ON projects
FOR EACH ROW EXECUTE FUNCTION app_validate_project_owner();

CREATE TABLE tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
    parent_task_id UUID REFERENCES tasks(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    target_department VARCHAR(50) NOT NULL DEFAULT 'FULLSTACK',
    required_level VARCHAR(20) NOT NULL DEFAULT 'JUNIOR',
    estimated_hours NUMERIC(8,2) NOT NULL DEFAULT 4.0,
    priority VARCHAR(20) NOT NULL DEFAULT 'MEDIUM',
    scheduled_for DATE,
    status VARCHAR(20) NOT NULL DEFAULT 'SCHEDULED',
    assigned_to UUID REFERENCES users(id) ON DELETE RESTRICT,
    checklist JSONB NOT NULL DEFAULT '[]'::jsonb,
    is_potential_blocker BOOLEAN NOT NULL DEFAULT false,
    is_blocked BOOLEAN NOT NULL DEFAULT false,
    block_reason VARCHAR(255),
    blocked_at TIMESTAMPTZ,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    status_entered_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- Cached output of the latest CPM run.  NULL means no successful calculation
    -- has been made yet; 0 must not mean both "zero" and "not calculated".
    early_start_hours NUMERIC(10,2),
    early_finish_hours NUMERIC(10,2),
    late_start_hours NUMERIC(10,2),
    late_finish_hours NUMERIC(10,2),
    slack_hours NUMERIC(10,2),
    is_critical_path BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_tasks_title_not_blank CHECK (length(btrim(title)) > 0),
    CONSTRAINT chk_tasks_priority CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH', 'URGENT')),
    CONSTRAINT chk_tasks_status CHECK (status IN ('SCHEDULED', 'TODO', 'IN_PROGRESS', 'REVIEW', 'DONE')),
    CONSTRAINT chk_tasks_department CHECK (target_department IN ('FRONTEND', 'BACKEND', 'DEVOPS', 'QA', 'FULLSTACK')),
    CONSTRAINT chk_tasks_level CHECK (required_level IN ('INTERN', 'FRESHER', 'JUNIOR', 'MIDDLE', 'SENIOR')),
    CONSTRAINT chk_tasks_hours CHECK (estimated_hours > 0),
    CONSTRAINT chk_tasks_checklist_is_array CHECK (jsonb_typeof(checklist) = 'array'),
    CONSTRAINT chk_tasks_block_state CHECK (
        (is_blocked AND block_reason IS NOT NULL AND length(btrim(block_reason)) > 0 AND blocked_at IS NOT NULL)
        OR
        (NOT is_blocked AND block_reason IS NULL AND blocked_at IS NULL)
    ),
    CONSTRAINT chk_tasks_done_not_blocked CHECK (status <> 'DONE' OR NOT is_blocked),
    -- Just-in-time dispatch: a task is unassigned until it leaves SCHEDULED.
    CONSTRAINT chk_tasks_assignment_lifecycle CHECK (
        (status = 'SCHEDULED' AND assigned_to IS NULL)
        OR (status <> 'SCHEDULED' AND assigned_to IS NOT NULL)
    ),
    CONSTRAINT chk_tasks_cpm_values CHECK (
        (early_start_hours IS NULL AND early_finish_hours IS NULL
         AND late_start_hours IS NULL AND late_finish_hours IS NULL
         AND slack_hours IS NULL)
        OR
        (early_start_hours >= 0 AND early_finish_hours >= early_start_hours
         AND late_start_hours >= 0 AND late_finish_hours >= late_start_hours
         AND slack_hours >= 0)
    )
);

CREATE TABLE task_dependencies (
    predecessor_id UUID NOT NULL REFERENCES tasks(id) ON DELETE RESTRICT,
    successor_id UUID NOT NULL REFERENCES tasks(id) ON DELETE RESTRICT,
    dependency_type VARCHAR(10) NOT NULL DEFAULT 'FS',
    lag_hours NUMERIC(8,2) NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (predecessor_id, successor_id),
    CONSTRAINT chk_no_self_dependency CHECK (predecessor_id <> successor_id),
    -- CPM implementation is Finish-to-Start in this version.  Do not accept
    -- SS/FF/SF until the scheduling engine implements their semantics.
    CONSTRAINT chk_dependency_type CHECK (dependency_type = 'FS'),
    CONSTRAINT chk_dependency_lag CHECK (lag_hours >= 0)
);

CREATE OR REPLACE FUNCTION app_validate_task_assignee_team()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.assigned_to IS NOT NULL AND NOT EXISTS (
        SELECT 1
        FROM projects p
        JOIN team_members tm ON tm.team_id = p.team_id
        JOIN users u ON u.id = tm.user_id
        WHERE p.id = NEW.project_id
          AND tm.user_id = NEW.assigned_to
          AND tm.left_at IS NULL
          AND u.is_active
    ) THEN
        RAISE EXCEPTION 'Task assignee must be an active member of the project team';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER a_validate_task_assignee_team
BEFORE INSERT OR UPDATE OF project_id, assigned_to ON tasks
FOR EACH ROW EXECUTE FUNCTION app_validate_task_assignee_team();

-- Database-level guard: dependency endpoints must belong to the same project,
-- and inserting an edge must not create a cycle.  The service must still run a
-- complete Kahn/CPM calculation in its transaction before publishing a plan.
CREATE OR REPLACE FUNCTION app_validate_task_dependency()
RETURNS TRIGGER AS $$
DECLARE
    predecessor_project UUID;
    successor_project UUID;
BEGIN
    SELECT project_id INTO predecessor_project FROM tasks WHERE id = NEW.predecessor_id;
    SELECT project_id INTO successor_project FROM tasks WHERE id = NEW.successor_id;

    IF predecessor_project IS NULL OR successor_project IS NULL
       OR predecessor_project <> successor_project THEN
        RAISE EXCEPTION 'Task dependencies must remain within one project';
    END IF;

    -- Reduces contention between graph edits.  The API must execute DAG writes
    -- at SERIALIZABLE isolation and retry serialization failures; an advisory
    -- lock alone does not refresh a statement snapshot under READ COMMITTED.
    PERFORM pg_advisory_xact_lock(hashtextextended(predecessor_project::text, 0));

    IF EXISTS (
        WITH RECURSIVE reachable(id) AS (
            SELECT NEW.successor_id
            UNION
            SELECT td.successor_id
            FROM task_dependencies td
            JOIN reachable r ON r.id = td.predecessor_id
        )
        SELECT 1 FROM reachable WHERE id = NEW.predecessor_id
    ) THEN
        RAISE EXCEPTION 'Task dependency would create a cycle';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER a_validate_task_dependency
BEFORE INSERT OR UPDATE OF predecessor_id, successor_id ON task_dependencies
FOR EACH ROW EXECUTE FUNCTION app_validate_task_dependency();

-- A planning run is needed to reproduce an AI recommendation and evaluate it.
CREATE TABLE dispatch_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
    dispatch_date DATE NOT NULL,
    requested_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    algorithm_version VARCHAR(100) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PREVIEW',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    finalized_at TIMESTAMPTZ,
    CONSTRAINT chk_dispatch_run_status CHECK (status IN ('PREVIEW', 'APPROVED', 'CANCELLED'))
);

CREATE TABLE dispatch_recommendations (
    dispatch_run_id UUID NOT NULL REFERENCES dispatch_runs(id) ON DELETE RESTRICT,
    task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE RESTRICT,
    candidate_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    candidate_rank SMALLINT NOT NULL CHECK (candidate_rank > 0),
    sparse_rank SMALLINT,
    dense_rank SMALLINT,
    rrf_score NUMERIC(12,10) NOT NULL CHECK (rrf_score >= 0),
    workload_hours NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (workload_hours >= 0),
    is_selected BOOLEAN NOT NULL DEFAULT false,
    selected_by_human BOOLEAN NOT NULL DEFAULT false,
    PRIMARY KEY (dispatch_run_id, task_id, candidate_user_id),
    UNIQUE (dispatch_run_id, task_id, candidate_rank)
);

CREATE TABLE task_dispatch_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dispatch_run_id UUID REFERENCES dispatch_runs(id) ON DELETE RESTRICT,
    task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE RESTRICT,
    assigned_to UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    dispatched_by UUID REFERENCES users(id) ON DELETE SET NULL,
    rrf_score NUMERIC(12,10),
    final_score NUMERIC(12,6),
    is_human_override BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_task_dispatch_once_per_run UNIQUE (dispatch_run_id, task_id)
);

CREATE INDEX idx_tasks_dispatch_lookup
    ON tasks (project_id, scheduled_for, id)
    WHERE status = 'SCHEDULED';
CREATE INDEX idx_tasks_kanban_board
    ON tasks (project_id, assigned_to, status, updated_at DESC)
    WHERE status <> 'SCHEDULED';
CREATE INDEX idx_task_deps_successor ON task_dependencies (successor_id);
CREATE INDEX idx_dispatch_recommendations_task
    ON dispatch_recommendations (dispatch_run_id, task_id, candidate_rank);
CREATE UNIQUE INDEX uq_dispatch_recommendation_selected
    ON dispatch_recommendations (dispatch_run_id, task_id)
    WHERE is_selected;

CREATE TRIGGER z_projects_updated_at
BEFORE UPDATE ON projects
FOR EACH ROW EXECUTE FUNCTION app_set_updated_at();
CREATE TRIGGER z_tasks_updated_at
BEFORE UPDATE ON tasks
FOR EACH ROW EXECUTE FUNCTION app_set_updated_at();

-- Candidate-generation query for UC-DISP-01.
-- It is NOT the global MS-RCPSP assignment step; pass these candidates to the
-- solver, then persist all candidates and the final choice in a dispatch run.
--
-- This is an application query template, not executable initialization SQL:
-- PostgreSQL does not understand :task_id, :task_query, or :task_embedding.
-- Keep it in the backend repository and bind values through its database driver.
/*
WITH task_context AS MATERIALIZED (
    SELECT t.id, p.team_id, t.target_department, t.required_level,
           websearch_to_tsquery('simple', :task_query) AS task_tsquery
    FROM tasks t
    JOIN projects p ON p.id = t.project_id
    WHERE t.id = :task_id
      AND t.status = 'SCHEDULED'
      AND NOT EXISTS (
          SELECT 1
          FROM task_dependencies td
          JOIN tasks predecessor ON predecessor.id = td.predecessor_id
          WHERE td.successor_id = t.id
            AND predecessor.status <> 'DONE'
      )
),
sparse_search AS MATERIALIZED (
    SELECT pr.user_id,
           row_number() OVER (ORDER BY ts_rank_cd(pr.search_vector, tc.task_tsquery) DESC, pr.user_id) AS rank_sparse
    FROM user_talent_profiles pr
    JOIN users u ON u.id = pr.user_id AND u.is_active
    JOIN team_members tm ON tm.user_id = pr.user_id AND tm.left_at IS NULL
    CROSS JOIN task_context tc
    WHERE tm.team_id = tc.team_id
      AND pr.department = tc.target_department
      AND CASE pr.level
            WHEN 'INTERN' THEN 1 WHEN 'FRESHER' THEN 2 WHEN 'JUNIOR' THEN 3
            WHEN 'MIDDLE' THEN 4 WHEN 'SENIOR' THEN 5 END
          >= CASE tc.required_level
            WHEN 'INTERN' THEN 1 WHEN 'FRESHER' THEN 2 WHEN 'JUNIOR' THEN 3
            WHEN 'MIDDLE' THEN 4 WHEN 'SENIOR' THEN 5 END
      AND pr.search_vector @@ tc.task_tsquery
    ORDER BY ts_rank_cd(pr.search_vector, tc.task_tsquery) DESC, pr.user_id
    LIMIT 50
),
dense_search AS MATERIALIZED (
    SELECT pr.user_id,
           row_number() OVER (ORDER BY pr.skill_embedding <=> :task_embedding, pr.user_id) AS rank_dense
    FROM user_talent_profiles pr
    JOIN users u ON u.id = pr.user_id AND u.is_active
    JOIN team_members tm ON tm.user_id = pr.user_id AND tm.left_at IS NULL
    CROSS JOIN task_context tc
    WHERE tm.team_id = tc.team_id
      AND pr.department = tc.target_department
      AND pr.skill_embedding IS NOT NULL
      AND pr.embedding_revision = pr.profile_revision
      AND CASE pr.level
            WHEN 'INTERN' THEN 1 WHEN 'FRESHER' THEN 2 WHEN 'JUNIOR' THEN 3
            WHEN 'MIDDLE' THEN 4 WHEN 'SENIOR' THEN 5 END
          >= CASE tc.required_level
            WHEN 'INTERN' THEN 1 WHEN 'FRESHER' THEN 2 WHEN 'JUNIOR' THEN 3
            WHEN 'MIDDLE' THEN 4 WHEN 'SENIOR' THEN 5 END
    ORDER BY pr.skill_embedding <=> :task_embedding, pr.user_id
    LIMIT 50
),
rrf AS (
    SELECT COALESCE(s.user_id, d.user_id) AS user_id,
           COALESCE(1.0 / (60 + s.rank_sparse), 0.0)
         + COALESCE(1.0 / (60 + d.rank_dense), 0.0) AS rrf_score,
           s.rank_sparse, d.rank_dense
    FROM sparse_search s
    FULL JOIN dense_search d USING (user_id)
),
workload AS (
    SELECT assigned_to AS user_id, COALESCE(sum(estimated_hours), 0) AS workload_hours
    FROM tasks
    WHERE status IN ('TODO', 'IN_PROGRESS', 'REVIEW')
    GROUP BY assigned_to
)
SELECT r.user_id, u.full_name, pr.level, r.rrf_score,
       r.rank_sparse, r.rank_dense, COALESCE(w.workload_hours, 0) AS workload_hours
FROM rrf r
JOIN users u ON u.id = r.user_id
JOIN user_talent_profiles pr ON pr.user_id = r.user_id
LEFT JOIN workload w ON w.user_id = r.user_id
ORDER BY r.rrf_score DESC, workload_hours ASC, r.user_id
LIMIT 10;
*/

-- Module 3: Kanban flow observability and adaptive-skill evidence.

-- 1. CẬP NHẬT THÊM CỘT CHO BẢNG TASKS
ALTER TABLE tasks 
ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS is_blocked BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS block_reason VARCHAR(255),
ADD COLUMN IF NOT EXISTS parent_task_id UUID REFERENCES tasks(id) ON DELETE CASCADE,
ADD COLUMN IF NOT EXISTS priority VARCHAR(20) NOT NULL DEFAULT 'MEDIUM';

-- 2. BẢNG GHI LỊCH SỬ CHUYỂN DỊCH TRẠNG THÁI (ĐỂ TÍNH CYCLE TIME & IQR)
CREATE TABLE IF NOT EXISTS task_status_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    changed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    from_status VARCHAR(20) NOT NULL,
    to_status VARCHAR(20) NOT NULL,
    duration_in_previous_status_hours NUMERIC(7, 2), -- Số giờ ở trạng thái cũ
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_status_history_values CHECK (
        from_status IN ('SCHEDULED', 'TODO', 'IN_PROGRESS', 'REVIEW', 'DONE')
        AND to_status IN ('SCHEDULED', 'TODO', 'IN_PROGRESS', 'REVIEW', 'DONE')
        AND from_status <> to_status
    ),
    CONSTRAINT chk_status_history_duration CHECK (duration_in_previous_status_hours IS NULL OR duration_in_previous_status_hours >= 0)
);

CREATE TABLE IF NOT EXISTS task_block_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    changed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    is_blocked BOOLEAN NOT NULL,
    reason VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_block_history_reason CHECK (
        (is_blocked AND reason IS NOT NULL AND length(btrim(reason)) > 0)
        OR (NOT is_blocked AND reason IS NULL)
    )
);

-- Required to connect a completed task to the skills whose evidence is updated.
CREATE TABLE IF NOT EXISTS task_required_skills (
    task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    skill_id UUID NOT NULL REFERENCES skills(id) ON DELETE RESTRICT,
    required_proficiency SMALLINT NOT NULL DEFAULT 3 CHECK (required_proficiency BETWEEN 1 AND 5),
    PRIMARY KEY (task_id, skill_id)
);

-- 3. BẢNG ĐIỂM KỸ NĂNG THÍCH ỨNG THEO ELO (DYNAMIC SKILL RATINGS)
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

-- Evidence is append-only.  Update user_skill_states from this evidence in the
-- service/Bayesian module; do not add an independent Elo rating table.
CREATE TABLE IF NOT EXISTS user_skill_evidence (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    skill_id UUID NOT NULL REFERENCES skills(id) ON DELETE RESTRICT,
    task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    observed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    outcome VARCHAR(20) NOT NULL,
    evidence_weight NUMERIC(5,4) NOT NULL DEFAULT 1.0000,
    note TEXT,
    observed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_skill_evidence_outcome CHECK (outcome IN ('ACCEPTED', 'REJECTED', 'OVERDUE')),
    CONSTRAINT chk_skill_evidence_weight CHECK (evidence_weight > 0 AND evidence_weight <= 1)
);

-- CHỈ MỤC TỐI ƯU TRUY VẤN QUAN TRẮC LUỒNG
CREATE INDEX IF NOT EXISTS idx_task_history_task_time 
ON task_status_history(task_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_task_status_history_flow_time
ON task_status_history (to_status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tasks_blocked_lookup 
ON tasks(project_id) 
WHERE is_blocked = true;

CREATE INDEX IF NOT EXISTS idx_user_skills_lookup 
ON user_skill_ratings(user_id, skill_name);

CREATE INDEX IF NOT EXISTS idx_user_skill_evidence_user_skill_time
ON user_skill_evidence (user_id, skill_id, observed_at DESC);

-- TRIGGER TỰ ĐỘNG CẬP NHẬT UPDATED_AT CHO USER_SKILL_RATINGS
CREATE TRIGGER z_user_skill_ratings_updated_at
BEFORE UPDATE ON user_skill_ratings
FOR EACH ROW EXECUTE FUNCTION app_set_updated_at();

CREATE OR REPLACE FUNCTION app_track_task_status_change()
RETURNS TRIGGER AS $$
DECLARE
    actor_id UUID;
    previous_duration NUMERIC(10,2);
BEGIN
    IF OLD.status = NEW.status THEN
        RETURN NEW;
    END IF;

    -- Data-lifecycle guard.  Role authorization is enforced by the API, which
    -- sets app.actor_id and verifies the caller before executing this UPDATE.
    IF NOT (
        (OLD.status = 'SCHEDULED' AND NEW.status = 'TODO') OR
        (OLD.status = 'TODO' AND NEW.status = 'IN_PROGRESS') OR
        (OLD.status = 'IN_PROGRESS' AND NEW.status = 'REVIEW') OR
        (OLD.status = 'REVIEW' AND NEW.status IN ('IN_PROGRESS', 'DONE'))
    ) THEN
        RAISE EXCEPTION 'Invalid task status transition: % -> %', OLD.status, NEW.status;
    END IF;

    IF NEW.status = 'TODO' AND EXISTS (
        SELECT 1
        FROM task_dependencies td
        JOIN tasks predecessor ON predecessor.id = td.predecessor_id
        WHERE td.successor_id = NEW.id
          AND predecessor.status <> 'DONE'
    ) THEN
        RAISE EXCEPTION 'A task cannot be dispatched until all predecessors are DONE';
    END IF;

    actor_id := NULLIF(current_setting('app.actor_id', true), '')::UUID;
    previous_duration := round(
        extract(epoch FROM (CURRENT_TIMESTAMP - OLD.status_entered_at)) / 3600.0,
        2
    );
    NEW.status_entered_at := CURRENT_TIMESTAMP;

    IF NEW.status = 'IN_PROGRESS' THEN
        NEW.started_at := COALESCE(OLD.started_at, CURRENT_TIMESTAMP);
        NEW.completed_at := NULL;
    ELSIF NEW.status = 'DONE' THEN
        NEW.completed_at := CURRENT_TIMESTAMP;
    END IF;

    INSERT INTO task_status_history (
        task_id, changed_by, from_status, to_status, duration_in_previous_status_hours
    ) VALUES (
        NEW.id, actor_id, OLD.status, NEW.status, previous_duration
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION app_track_task_block_change()
RETURNS TRIGGER AS $$
DECLARE
    actor_id UUID;
BEGIN
    IF OLD.is_blocked IS NOT DISTINCT FROM NEW.is_blocked
       AND OLD.block_reason IS NOT DISTINCT FROM NEW.block_reason THEN
        RETURN NEW;
    END IF;

    actor_id := NULLIF(current_setting('app.actor_id', true), '')::UUID;
    IF NEW.is_blocked THEN
        NEW.blocked_at := COALESCE(OLD.blocked_at, CURRENT_TIMESTAMP);
    ELSE
        NEW.blocked_at := NULL;
        NEW.block_reason := NULL;
    END IF;

    INSERT INTO task_block_history (task_id, changed_by, is_blocked, reason)
    VALUES (NEW.id, actor_id, NEW.is_blocked, NEW.block_reason);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER a_track_task_status_change
BEFORE UPDATE OF status ON tasks
FOR EACH ROW EXECUTE FUNCTION app_track_task_status_change();

CREATE TRIGGER b_track_task_block_change
BEFORE UPDATE OF is_blocked, block_reason ON tasks
FOR EACH ROW EXECUTE FUNCTION app_track_task_block_change();
