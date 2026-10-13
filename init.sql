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