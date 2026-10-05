-- ============================================================================
-- Fluxer Polls Database Schema (PostgreSQL)
-- Supports Simple Polls, Ranked Choice, Anonymous Voting, Full Audit Logging
--
-- Design decisions:
--   - poll_type covers single_choice (simple) and ranked_choice.
--     multiple_choice is kept for forward-compatibility but the issue requires
--     only simple and ranked choice as the two primary modes.
--   - poll_permissions is its OWN table, not a flag on users, so it can be
--     granted/revoked per-user per-community by moderators without touching
--     the users table. Follows the pattern in community_events permissions.
--   - max_total_answers enforces the configurable answer cap (creator options
--     + write-ins combined). Default 20. Checked server-side on every write.
--   - image_attachment_id on poll_options links to the shared attachments
--     table so expiry, message_id, and IP logging reuse the existing pipeline.
--   - Anonymity: voter identity is stored in poll_votes/poll_ranked_ballots
--     always (so mods can audit) but the API layer strips user_id from
--     responses when is_anonymous = TRUE and caller is not a moderator/admin.
-- ============================================================================

CREATE TYPE poll_type_enum   AS ENUM ('single_choice', 'multiple_choice', 'ranked_choice');
CREATE TYPE poll_status_enum AS ENUM ('active', 'closed', 'deleted');

-- ---------------------------------------------------------------------------
-- 0. Poll Permissions
--    Separate permission from SEND_MESSAGES so the creation UI can be hidden
--    when absent, and the server enforces it independently.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS poll_permissions (
    id           BIGSERIAL    PRIMARY KEY,
    user_id      VARCHAR(64)  NOT NULL,
    community_id VARCHAR(64)  NOT NULL,
    granted_by   VARCHAR(64)  NOT NULL,   -- moderator/admin who granted
    granted_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    revoked_at   TIMESTAMPTZ,             -- NULL = currently active
    CONSTRAINT uq_poll_perm UNIQUE (user_id, community_id)
);

-- Partial index: only active (non-revoked) grants need fast lookup
CREATE INDEX IF NOT EXISTS idx_poll_permissions_active
    ON poll_permissions (user_id, community_id)
    WHERE revoked_at IS NULL;

-- ---------------------------------------------------------------------------
-- 1. Main Polls Table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS polls (
    id                    VARCHAR(64)      PRIMARY KEY,
    message_id            VARCHAR(64)      NOT NULL UNIQUE,
    channel_id            VARCHAR(64)      NOT NULL,
    community_id          VARCHAR(64),
    creator_id            VARCHAR(64)      NOT NULL,
    question              TEXT             NOT NULL,
    poll_type             poll_type_enum   NOT NULL DEFAULT 'single_choice',
    is_anonymous          BOOLEAN          NOT NULL DEFAULT FALSE,
    allow_custom_responses BOOLEAN         NOT NULL DEFAULT FALSE,
    -- max_total_answers caps creator options + custom write-ins combined.
    -- Enforced on every INSERT into poll_options. Default: 20.
    max_total_answers     INT              NOT NULL DEFAULT 20 CHECK (max_total_answers BETWEEN 2 AND 200),
    max_ranked_choices    INT              DEFAULT 5,
    status                poll_status_enum NOT NULL DEFAULT 'active',
    created_at            TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
    expires_at            TIMESTAMPTZ      NOT NULL,
    closed_at             TIMESTAMPTZ,
    closed_by             VARCHAR(64)
);

CREATE INDEX IF NOT EXISTS idx_polls_channel ON polls (channel_id, status);
CREATE INDEX IF NOT EXISTS idx_polls_expiry  ON polls (expires_at) WHERE status = 'active';

-- ---------------------------------------------------------------------------
-- 2. Poll Options Table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS poll_options (
    id                   VARCHAR(64)  PRIMARY KEY,
    poll_id              VARCHAR(64)  NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
    text                 TEXT         NOT NULL,
    -- image_attachment_id ties into the shared attachments table for expiry
    -- and logging (message_id, uploader_ip) reuse. NULL if no image.
    image_attachment_id  VARCHAR(64),
    image_url            TEXT,
    image_thumbnail_url  TEXT,
    order_index          INT          NOT NULL DEFAULT 0,
    creator_id           VARCHAR(64)  NOT NULL,  -- tracked even on anonymous polls
    is_custom            BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_poll_options_poll ON poll_options (poll_id, order_index);

-- Enforce max_total_answers server-side via trigger
CREATE OR REPLACE FUNCTION check_poll_answer_limit()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    current_count INT;
    max_allowed   INT;
BEGIN
    SELECT COUNT(*), p.max_total_answers
    INTO   current_count, max_allowed
    FROM   poll_options po
    JOIN   polls p ON p.id = po.poll_id
    WHERE  po.poll_id = NEW.poll_id
    GROUP BY p.max_total_answers;

    IF current_count >= max_allowed THEN
        RAISE EXCEPTION 'poll_answer_limit_exceeded: poll % already has % options (max %)',
            NEW.poll_id, current_count, max_allowed
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_poll_answer_limit
    BEFORE INSERT ON poll_options
    FOR EACH ROW EXECUTE FUNCTION check_poll_answer_limit();

-- ---------------------------------------------------------------------------
-- 3. Poll Votes Table (Simple / Multiple Choice)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS poll_votes (
    id        BIGSERIAL    PRIMARY KEY,
    poll_id   VARCHAR(64)  NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
    option_id VARCHAR(64)  NOT NULL REFERENCES poll_options(id) ON DELETE CASCADE,
    user_id   VARCHAR(64)  NOT NULL,
    voted_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_poll_user_option UNIQUE (poll_id, user_id, option_id)
);

CREATE INDEX IF NOT EXISTS idx_poll_votes_poll ON poll_votes (poll_id, option_id);
CREATE INDEX IF NOT EXISTS idx_poll_votes_user ON poll_votes (user_id);

-- Prevent voting after poll expires (server clock is authoritative)
CREATE OR REPLACE FUNCTION check_poll_open_for_vote()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    poll_status poll_status_enum;
    poll_expiry TIMESTAMPTZ;
BEGIN
    SELECT status, expires_at INTO poll_status, poll_expiry
    FROM polls WHERE id = NEW.poll_id;

    IF poll_status <> 'active' OR NOW() >= poll_expiry THEN
        RAISE EXCEPTION 'poll_closed: poll % is no longer accepting votes',
            NEW.poll_id
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_poll_vote_open_check
    BEFORE INSERT ON poll_votes
    FOR EACH ROW EXECUTE FUNCTION check_poll_open_for_vote();

-- ---------------------------------------------------------------------------
-- 4. Ranked Choice Ballots Table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS poll_ranked_ballots (
    id            BIGSERIAL    PRIMARY KEY,
    poll_id       VARCHAR(64)  NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
    user_id       VARCHAR(64)  NOT NULL,
    option_id     VARCHAR(64)  NOT NULL REFERENCES poll_options(id) ON DELETE CASCADE,
    rank_position INT          NOT NULL CHECK (rank_position > 0),
    voted_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_ranked_ballot_pos    UNIQUE (poll_id, user_id, rank_position),
    CONSTRAINT uq_ranked_ballot_option UNIQUE (poll_id, user_id, option_id)  -- no duplicates
);

CREATE INDEX IF NOT EXISTS idx_ranked_ballots_poll ON poll_ranked_ballots (poll_id, rank_position);

-- Reuse the same open-poll guard for ranked ballots
CREATE TRIGGER trg_ranked_vote_open_check
    BEFORE INSERT ON poll_ranked_ballots
    FOR EACH ROW EXECUTE FUNCTION check_poll_open_for_vote();

-- ---------------------------------------------------------------------------
-- 5. Poll Audit Logs Table
--    Format follows existing audit event conventions so bots can ingest them:
--    - action is a namespaced string (e.g. "poll.create", "poll.vote")
--    - details is JSONB for structured extra data
--    - actor_id + actor_username always recorded, even on anonymous polls
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS poll_audit_logs (
    id               BIGSERIAL    PRIMARY KEY,
    -- Audit event type: namespaced to "poll.*" to match existing conventions
    action           VARCHAR(50)  NOT NULL
        CHECK (action IN (
            'poll.create',
            'poll.close',
            'poll.delete',
            'poll.vote',
            'poll.vote_retract',
            'poll.custom_option_add',
            'poll.image_review',
            'poll.permission_grant',
            'poll.permission_revoke'
        )),
    poll_id          VARCHAR(64)  NOT NULL,
    channel_id       VARCHAR(64)  NOT NULL,
    community_id     VARCHAR(64),
    actor_id         VARCHAR(64)  NOT NULL,
    actor_username   VARCHAR(100) NOT NULL,
    target_option_id VARCHAR(64),         -- for vote / custom_option_add
    details          JSONB,               -- structured payload for bot ingestion
    ip_address       INET,                -- from request, for moderation
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_poll_audit_poll   ON poll_audit_logs (poll_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_poll_audit_actor  ON poll_audit_logs (actor_id);
CREATE INDEX IF NOT EXISTS idx_poll_audit_action ON poll_audit_logs (action);
