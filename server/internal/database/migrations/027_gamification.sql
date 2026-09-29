-- Onboarding and the gamified mode (specs/GAMIFICATION.md). Rules live in
-- server/internal/gamification; these tables only store their results.

-- One row per account, created on the first recorded XP or at onboarding.
-- enabled = FALSE is Calm mode: XP is still recorded, nothing is shown, and
-- the account never appears on a leaderboard.
CREATE TABLE IF NOT EXISTS game_profiles (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    onboarding_version INTEGER NOT NULL DEFAULT 0,
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    -- Public identity: never the email or real name.
    handle TEXT CHECK (handle ~ '^[a-z0-9_]{3,20}$'),
    anonymous_key TEXT NOT NULL DEFAULT '',
    visibility TEXT NOT NULL DEFAULT 'hidden' CHECK (visibility IN ('public', 'anonymous', 'hidden')),
    effects TEXT NOT NULL DEFAULT 'full' CHECK (effects IN ('full', 'subtle', 'off')),
    sounds BOOLEAN NOT NULL DEFAULT FALSE,
    time_zone TEXT NOT NULL DEFAULT 'UTC',
    xp BIGINT NOT NULL DEFAULT 0 CHECK (xp >= 0),
    level INTEGER NOT NULL DEFAULT 1,
    -- Highest level whose chest was granted, so losing and regaining a level
    -- (un-completing then re-completing) never grants its chest twice.
    rewarded_level INTEGER NOT NULL DEFAULT 1,
    streak_current INTEGER NOT NULL DEFAULT 0,
    streak_best INTEGER NOT NULL DEFAULT 0,
    streak_last_day DATE,
    streak_freezes INTEGER NOT NULL DEFAULT 0 CHECK (streak_freezes >= 0),
    stardust INTEGER NOT NULL DEFAULT 0 CHECK (stardust >= 0),
    league_tier INTEGER NOT NULL DEFAULT 0,
    -- The egg is given at onboarding (pet_egg_at) and hatches on the next
    -- completion into a species rolled on the server.
    pet_egg_at TIMESTAMPTZ,
    pet_species TEXT CHECK (pet_species IN ('mochi', 'fern', 'nova', 'ember')),
    pet_name TEXT NOT NULL DEFAULT '' CHECK (char_length(pet_name) <= 24),
    pet_hatched_at TIMESTAMPTZ,
    -- Equipped cosmetics by slot, e.g. {"nameEffect":"gold","border":"laurel"}.
    equipped JSONB NOT NULL DEFAULT '{}'::jsonb,
    pinned_achievements JSONB NOT NULL DEFAULT '[]'::jsonb,
    activated_at TIMESTAMPTZ,
    backfilled_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS game_profiles_handle_idx ON game_profiles(handle) WHERE handle IS NOT NULL;
CREATE INDEX IF NOT EXISTS game_profiles_board_idx ON game_profiles(xp DESC) WHERE enabled AND visibility <> 'hidden';

-- The XP ledger. A source earns XP at most once: un-completing a task sets
-- revoked_at, completing it again clears it and restores the same amount.
CREATE TABLE IF NOT EXISTS xp_events (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    source_kind TEXT NOT NULL CHECK (source_kind IN ('task', 'habit', 'kudos', 'achievement', 'onboarding')),
    source_id TEXT NOT NULL,
    project_id UUID,
    amount INTEGER NOT NULL CHECK (amount >= 0),
    -- The user's calendar day, for the daily curve and streaks.
    day DATE NOT NULL,
    -- What achievements count: the task's quadrant, whether it beat its due
    -- date, and the local hour it was completed at.
    quadrant TEXT CHECK (quadrant IN ('focus', 'plan', 'quick', 'later')),
    on_time BOOLEAN NOT NULL DEFAULT FALSE,
    local_hour SMALLINT,
    -- Credited from history on first activation: counts toward level and
    -- all-time boards, never toward weekly leagues.
    backfill BOOLEAN NOT NULL DEFAULT FALSE,
    revoked_at TIMESTAMPTZ,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, source_kind, source_id)
);

CREATE INDEX IF NOT EXISTS xp_events_user_day_idx ON xp_events(user_id, day);
CREATE INDEX IF NOT EXISTS xp_events_project_idx ON xp_events(project_id, occurred_at) WHERE project_id IS NOT NULL AND revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS xp_events_league_idx ON xp_events(occurred_at, user_id) WHERE revoked_at IS NULL AND NOT backfill;

CREATE TABLE IF NOT EXISTS user_achievements (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    achievement_id TEXT NOT NULL,
    unlocked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, achievement_id)
);

CREATE TABLE IF NOT EXISTS inventory_items (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    item_id TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT '',
    acquired_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, item_id)
);

-- Chest contents are rolled when the chest is granted, never when opened.
-- (source, source_ref) makes grants idempotent, e.g. ('level', '12').
CREATE TABLE IF NOT EXISTS chests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tier TEXT NOT NULL CHECK (tier IN ('common', 'rare', 'epic', 'legendary')),
    source TEXT NOT NULL,
    source_ref TEXT NOT NULL,
    contents JSONB NOT NULL DEFAULT '[]'::jsonb,
    granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    opened_at TIMESTAMPTZ,
    UNIQUE (user_id, source, source_ref)
);

CREATE INDEX IF NOT EXISTS chests_unopened_idx ON chests(user_id, granted_at) WHERE opened_at IS NULL;

-- Celebrations the client has not shown yet (level-up, hatch, achievement,
-- chest, streak milestone, league result). Any device may show and ack them.
CREATE TABLE IF NOT EXISTS game_events (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    seen_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS game_events_unseen_idx ON game_events(user_id, id) WHERE seen_at IS NULL;

-- Weekly leagues. A player joins a cohort of their tier when they earn their
-- first league XP of the week; closed cohorts keep their results.
CREATE TABLE IF NOT EXISTS league_cohorts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    week_start DATE NOT NULL,
    tier INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    closed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS league_cohorts_week_idx ON league_cohorts(week_start, tier);

CREATE TABLE IF NOT EXISTS league_members (
    cohort_id UUID NOT NULL REFERENCES league_cohorts(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    week_start DATE NOT NULL,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    final_rank INTEGER,
    outcome TEXT CHECK (outcome IN ('promoted', 'stayed', 'demoted')),
    PRIMARY KEY (cohort_id, user_id),
    UNIQUE (user_id, week_start)
);

-- Project leaderboards live beside the project, not on it, so workspace sync
-- can never overwrite them. Only the owner changes the mode.
CREATE TABLE IF NOT EXISTS project_game_settings (
    project_id UUID PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
    mode TEXT NOT NULL DEFAULT 'off' CHECK (mode IN ('off', 'competitive', 'team')),
    team_goal_xp INTEGER NOT NULL DEFAULT 0 CHECK (team_goal_xp >= 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Each member decides once whether to appear on a project's leaderboard.
CREATE TABLE IF NOT EXISTS project_leaderboard_optins (
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined BOOLEAN NOT NULL,
    decided_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (project_id, user_id)
);

CREATE TABLE IF NOT EXISTS kudos (
    from_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    task_id UUID NOT NULL,
    to_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (from_user_id, task_id)
);

CREATE INDEX IF NOT EXISTS kudos_to_idx ON kudos(to_user_id, created_at);
