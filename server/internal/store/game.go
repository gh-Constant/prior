package store

import (
	"context"
	cryptorand "crypto/rand"
	"encoding/binary"
	"encoding/json"
	"errors"
	"log/slog"
	"math/rand/v2"
	"slices"
	"strconv"
	"time"

	"github.com/gh-Constant/prior/server/internal/gamification"
	"github.com/gh-Constant/prior/server/internal/tasks"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// The gamified mode (specs/GAMIFICATION.md). XP is recorded for every account
// inside the same transaction as the task or habit mutation that earns it;
// the profile only shows it when the account chose the gamified experience.

var (
	ErrHandleTaken   = errors.New("handle already taken")
	ErrInvalidHandle = errors.New("invalid handle")
	ErrNotOwned      = errors.New("item not owned")
	ErrNotEnough     = errors.New("not enough stardust")
)

// leagueLockKey serializes cohort assignment so cohorts never overfill.
const leagueLockKey = 90733101

// A completion synced more than this long after it happened is dated to the
// sync instead: a forged or very stale timestamp cannot spread XP across past
// days to dodge the daily cap.
const maxCompletionAge = 48 * time.Hour

type gameProfileRow struct {
	UserID            uuid.UUID
	OnboardingVersion int
	Enabled           bool
	Handle            *string
	AnonymousKey      string
	Visibility        string
	Effects           string
	Sounds            bool
	TimeZone          string
	XP                int64
	Level             int
	RewardedLevel     int
	Streak            gamification.Streak
	Stardust          int
	LeagueTier        int
	PetEggAt          *time.Time
	PetSpecies        *string
	PetName           string
	PetHatchedAt      *time.Time
	Equipped          map[string]string
	Pinned            []string
	ActivatedAt       *time.Time
	BackfilledAt      *time.Time
}

const gameProfileColumns = `user_id, onboarding_version, enabled, handle, anonymous_key, visibility, effects, sounds, time_zone,
	xp, level, rewarded_level, streak_current, streak_best, streak_last_day::text, streak_freezes, stardust, league_tier,
	pet_egg_at, pet_species, pet_name, pet_hatched_at, equipped, pinned_achievements, activated_at, backfilled_at`

func scanGameProfile(row pgx.Row) (gameProfileRow, error) {
	var p gameProfileRow
	var lastDay *string
	var equipped, pinned []byte
	err := row.Scan(&p.UserID, &p.OnboardingVersion, &p.Enabled, &p.Handle, &p.AnonymousKey, &p.Visibility, &p.Effects, &p.Sounds, &p.TimeZone,
		&p.XP, &p.Level, &p.RewardedLevel, &p.Streak.Current, &p.Streak.Best, &lastDay, &p.Streak.Freezes, &p.Stardust, &p.LeagueTier,
		&p.PetEggAt, &p.PetSpecies, &p.PetName, &p.PetHatchedAt, &equipped, &pinned, &p.ActivatedAt, &p.BackfilledAt)
	if err != nil {
		return p, err
	}
	if lastDay != nil {
		p.Streak.LastDay = *lastDay
	}
	p.Equipped = map[string]string{}
	if err := json.Unmarshal(equipped, &p.Equipped); err != nil {
		return p, err
	}
	p.Pinned = []string{}
	if err := json.Unmarshal(pinned, &p.Pinned); err != nil {
		return p, err
	}
	return p, nil
}

// lockGameProfileTx returns the account's profile, creating it on first use,
// locked for the rest of the transaction.
func lockGameProfileTx(ctx context.Context, tx pgx.Tx, userID uuid.UUID) (gameProfileRow, error) {
	if _, err := tx.Exec(ctx, `INSERT INTO game_profiles (user_id, anonymous_key) VALUES ($1, $2) ON CONFLICT (user_id) DO NOTHING`, userID, gamification.RandomAnonymousKey(newGameRNG())); err != nil {
		return gameProfileRow{}, err
	}
	return scanGameProfile(tx.QueryRow(ctx, `SELECT `+gameProfileColumns+` FROM game_profiles WHERE user_id = $1 FOR UPDATE`, userID))
}

func saveGameProfileTx(ctx context.Context, tx pgx.Tx, p gameProfileRow) error {
	equipped, err := json.Marshal(p.Equipped)
	if err != nil {
		return err
	}
	pinned, err := json.Marshal(p.Pinned)
	if err != nil {
		return err
	}
	var lastDay *string
	if p.Streak.LastDay != "" {
		lastDay = &p.Streak.LastDay
	}
	_, err = tx.Exec(ctx, `
		UPDATE game_profiles SET onboarding_version = $2, enabled = $3, handle = $4, visibility = $5, effects = $6, sounds = $7, time_zone = $8,
			xp = $9, level = $10, rewarded_level = $11, streak_current = $12, streak_best = $13, streak_last_day = $14::date, streak_freezes = $15,
			stardust = $16, league_tier = $17, pet_egg_at = $18, pet_species = $19, pet_name = $20, pet_hatched_at = $21,
			equipped = $22, pinned_achievements = $23, activated_at = $24, backfilled_at = $25, updated_at = now()
		WHERE user_id = $1`,
		p.UserID, p.OnboardingVersion, p.Enabled, p.Handle, p.Visibility, p.Effects, p.Sounds, p.TimeZone,
		p.XP, p.Level, p.RewardedLevel, p.Streak.Current, p.Streak.Best, lastDay, p.Streak.Freezes,
		p.Stardust, p.LeagueTier, p.PetEggAt, p.PetSpecies, p.PetName, p.PetHatchedAt,
		equipped, pinned, p.ActivatedAt, p.BackfilledAt)
	return err
}

func newGameRNG() *rand.Rand {
	var seed [32]byte
	if _, err := cryptorand.Read(seed[:]); err != nil {
		binary.LittleEndian.PutUint64(seed[:], uint64(time.Now().UnixNano()))
	}
	return rand.New(rand.NewChaCha8(seed))
}

type pendingGameEvent struct {
	kind    string
	payload map[string]any
}

// gameSession applies one or more awards to a locked profile and records
// the celebrations they cause. Callers must call finish before committing.
type gameSession struct {
	ctx     context.Context
	tx      pgx.Tx
	p       gameProfileRow
	now     time.Time
	loc     *time.Location
	rng     *rand.Rand
	owned   map[string]bool
	trigger gamification.Stats
	// quiet suppresses per-level events, for the one-time history backfill.
	quiet  bool
	events []pendingGameEvent
}

func beginGameSession(ctx context.Context, tx pgx.Tx, userID uuid.UUID, now time.Time) (*gameSession, error) {
	profile, err := lockGameProfileTx(ctx, tx, userID)
	if err != nil {
		return nil, err
	}
	return &gameSession{ctx: ctx, tx: tx, p: profile, now: now, loc: gamification.LoadLocation(profile.TimeZone), rng: newGameRNG()}, nil
}

func (g *gameSession) today() string { return g.now.In(g.loc).Format(time.DateOnly) }

// emit queues a celebration. Calm accounts get none: their XP, chests and
// achievements wait silently until they switch to the gamified experience.
func (g *gameSession) emit(kind string, payload map[string]any) {
	if g.p.Enabled {
		g.events = append(g.events, pendingGameEvent{kind: kind, payload: payload})
	}
}

func (g *gameSession) finish() error {
	if err := saveGameProfileTx(g.ctx, g.tx, g.p); err != nil {
		return err
	}
	for _, event := range g.events {
		payload, err := json.Marshal(event.payload)
		if err != nil {
			return err
		}
		if _, err := g.tx.Exec(g.ctx, `INSERT INTO game_events (user_id, kind, payload) VALUES ($1, $2, $3)`, g.p.UserID, event.kind, payload); err != nil {
			return err
		}
	}
	return nil
}

// addXP moves the profile along the level curve. New levels grant their chest
// once ever (rewarded_level), so losing and regaining a level gives nothing.
func (g *gameSession) addXP(delta int64) error {
	g.p.XP = max(0, g.p.XP+delta)
	level := gamification.ProgressFor(g.p.XP).Level
	g.p.Level = level
	for next := g.p.RewardedLevel + 1; next <= level; next++ {
		tier := gamification.ChestForLevel(next)
		chestID, err := g.grantChest(tier, "level", strconv.Itoa(next))
		if err != nil {
			return err
		}
		if g.quiet {
			continue
		}
		g.emit("level_up", map[string]any{"level": next, "rank": gamification.RankFor(next), "chestId": chestID, "chestTier": tier})
		if g.p.PetHatchedAt != nil && (next == 10 || next == 25 || next == 50) {
			g.emit("pet_evolved", map[string]any{"stage": gamification.PetStageFor(next, true), "species": g.p.PetSpecies})
		}
	}
	g.p.RewardedLevel = max(g.p.RewardedLevel, level)
	return nil
}

func (g *gameSession) ownedItems() (map[string]bool, error) {
	if g.owned != nil {
		return g.owned, nil
	}
	rows, err := g.tx.Query(g.ctx, `SELECT item_id FROM inventory_items WHERE user_id = $1`, g.p.UserID)
	if err != nil {
		return nil, err
	}
	owned, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return nil, err
	}
	g.owned = map[string]bool{}
	for _, id := range owned {
		g.owned[id] = true
	}
	return g.owned, nil
}

// grantChest rolls a chest's contents now, once: a second grant for the same
// source is ignored and returns an empty id.
func (g *gameSession) grantChest(tier gamification.Rarity, source, ref string) (string, error) {
	owned, err := g.ownedItems()
	if err != nil {
		return "", err
	}
	contents, err := json.Marshal(gamification.RollChest(tier, gamification.Catalog, owned, g.rng))
	if err != nil {
		return "", err
	}
	var id string
	err = g.tx.QueryRow(g.ctx, `
		INSERT INTO chests (user_id, tier, source, source_ref, contents) VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (user_id, source, source_ref) DO NOTHING RETURNING id::text`, g.p.UserID, tier, source, ref, contents).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	return id, err
}

func (g *gameSession) recordStreakDay(day string) error {
	if day > g.today() {
		return nil
	}
	if last, err := time.Parse(time.DateOnly, g.p.Streak.LastDay); err == nil {
		if current, err := time.Parse(time.DateOnly, day); err == nil && current.Sub(last) >= 7*24*time.Hour {
			g.trigger.Comeback = true
		}
	}
	next, update := g.p.Streak.Record(day)
	g.p.Streak = next
	if update.FreezesUsed > 0 {
		g.emit("freeze_used", map[string]any{"count": update.FreezesUsed, "streak": next.Current})
	}
	if update.Milestone != "" {
		chestID, err := g.grantChest(update.Milestone, "streak", strconv.Itoa(next.Current))
		if err != nil {
			return err
		}
		g.emit("streak_milestone", map[string]any{"days": next.Current, "chestId": chestID, "chestTier": update.Milestone})
	}
	return nil
}

func (g *gameSession) hatchIfReady() {
	if g.p.PetEggAt == nil || g.p.PetHatchedAt != nil {
		return
	}
	species := gamification.RollPetSpecies(g.rng)
	now := g.now
	g.p.PetSpecies = &species
	g.p.PetHatchedAt = &now
	g.emit("pet_hatched", map[string]any{"species": species, "rare": species == "ember"})
}

func (g *gameSession) grantOnboardingBonus() error {
	if g.p.OnboardingVersion == 0 {
		return nil
	}
	tag, err := g.tx.Exec(g.ctx, `
		INSERT INTO xp_events (user_id, source_kind, source_id, amount, day) VALUES ($1, 'onboarding', 'welcome', $2, $3::date)
		ON CONFLICT (user_id, source_kind, source_id) DO NOTHING`, g.p.UserID, gamification.OnboardingXP, g.today())
	if err != nil || tag.RowsAffected() == 0 {
		return err
	}
	return g.addXP(gamification.OnboardingXP)
}

// restoreOrRevoke flips an existing ledger entry. It reports whether an
// entry existed at all, so callers know to create one.
func (g *gameSession) restoreOrRevoke(kind, sourceID string, revoke bool) (bool, error) {
	var amount int64
	var revoked bool
	err := g.tx.QueryRow(g.ctx, `SELECT amount, revoked_at IS NOT NULL FROM xp_events WHERE user_id = $1 AND source_kind = $2 AND source_id = $3`, g.p.UserID, kind, sourceID).Scan(&amount, &revoked)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	switch {
	case revoke && !revoked:
		if _, err := g.tx.Exec(g.ctx, `UPDATE xp_events SET revoked_at = now() WHERE user_id = $1 AND source_kind = $2 AND source_id = $3`, g.p.UserID, kind, sourceID); err != nil {
			return true, err
		}
		return true, g.addXP(-amount)
	case !revoke && revoked:
		if _, err := g.tx.Exec(g.ctx, `UPDATE xp_events SET revoked_at = NULL WHERE user_id = $1 AND source_kind = $2 AND source_id = $3`, g.p.UserID, kind, sourceID); err != nil {
			return true, err
		}
		return true, g.addXP(amount)
	}
	return true, nil
}

func (g *gameSession) dayTaskXP(day string) (int, error) {
	var earned int
	err := g.tx.QueryRow(g.ctx, `SELECT COALESCE(SUM(amount), 0) FROM xp_events WHERE user_id = $1 AND source_kind = 'task' AND day = $2::date AND revoked_at IS NULL AND NOT backfill`, g.p.UserID, day).Scan(&earned)
	return earned, err
}

// awardTask records a newly completed task. completedAt is the client's
// completion time, clamped to the recent past.
func (g *gameSession) awardTask(task tasks.Task, taskID uuid.UUID, completedAt time.Time) error {
	if exists, err := g.restoreOrRevoke("task", taskID.String(), false); err != nil || exists {
		return err
	}
	if completedAt.After(g.now) || g.now.Sub(completedAt) > maxCompletionAge {
		completedAt = g.now
	}
	local := completedAt.In(g.loc)
	day := local.Format(time.DateOnly)
	raw := gamification.TaskXP(gamification.TaskCompletion{Important: task.Important, Urgent: task.Urgent, DueDate: task.DueDate, CreatedAt: task.CreatedAt, CompletedAt: completedAt, Location: g.loc})
	earned, err := g.dayTaskXP(day)
	if err != nil {
		return err
	}
	amount := gamification.ApplyDailyCurve(earned, raw)
	// A farmed completion keeps its quadrant empty so it never counts toward achievements.
	var quadrant *string
	var hour *int
	if completedAt.Sub(task.CreatedAt) >= gamification.MinTaskAge {
		value := string(gamification.QuadrantOf(task.Important, task.Urgent))
		quadrant = &value
		h := local.Hour()
		hour = &h
	}
	onTime := quadrant != nil && task.DueDate != nil && gamification.CompletedOnTime(*task.DueDate, completedAt, g.loc)
	var projectID *uuid.UUID
	if task.ProjectID != nil {
		if parsed, err := uuid.Parse(*task.ProjectID); err == nil {
			projectID = &parsed
		}
	}
	if _, err := g.tx.Exec(g.ctx, `
		INSERT INTO xp_events (user_id, source_kind, source_id, project_id, amount, day, quadrant, on_time, local_hour, occurred_at)
		VALUES ($1, 'task', $2, $3, $4, $5::date, $6, $7, $8, $9)`,
		g.p.UserID, taskID.String(), projectID, amount, day, quadrant, onTime, hour, completedAt); err != nil {
		return err
	}
	if quadrant != nil && *quadrant == string(gamification.Focus) {
		// Clearing the Focus quadrant only counts after real work that day.
		var cleared bool
		if err := g.tx.QueryRow(g.ctx, `
			SELECT NOT EXISTS (SELECT 1 FROM tasks WHERE user_id = $1 AND important AND urgent AND NOT completed AND deleted_at IS NULL AND id <> $2)
			   AND (SELECT count(*) FROM xp_events WHERE user_id = $1 AND source_kind = 'task' AND quadrant = 'focus' AND day = $3::date AND revoked_at IS NULL) >= $4`,
			g.p.UserID, taskID, day, gamification.ClearedFocusMinimum).Scan(&cleared); err != nil {
			return err
		}
		g.trigger.ClearedFocus = cleared
	}
	if err := g.recordStreakDay(day); err != nil {
		return err
	}
	g.hatchIfReady()
	if err := g.addXP(int64(amount)); err != nil {
		return err
	}
	if err := g.grantOnboardingBonus(); err != nil {
		return err
	}
	if amount > 0 {
		if err := g.joinLeague(); err != nil {
			return err
		}
	}
	return g.evaluateAchievements()
}

func (g *gameSession) awardHabitCheckIn(habitID uuid.UUID, date string, dates []string) error {
	sourceID := habitID.String() + ":" + date
	if exists, err := g.restoreOrRevoke("habit", sourceID, false); err != nil || exists {
		return err
	}
	if !gamification.HabitCheckInEligible(date, g.today()) {
		return nil
	}
	amount := gamification.HabitCheckInXP(gamification.ConsecutiveDays(dates, date) - 1)
	if _, err := g.tx.Exec(g.ctx, `INSERT INTO xp_events (user_id, source_kind, source_id, amount, day) VALUES ($1, 'habit', $2, $3, $4::date)`, g.p.UserID, sourceID, amount, date); err != nil {
		return err
	}
	if err := g.recordStreakDay(date); err != nil {
		return err
	}
	g.hatchIfReady()
	if err := g.addXP(int64(amount)); err != nil {
		return err
	}
	if err := g.joinLeague(); err != nil {
		return err
	}
	return g.evaluateAchievements()
}

// joinLeague puts a visible gamified player into a cohort of their tier the
// first time they earn league XP in a week.
func (g *gameSession) joinLeague() error {
	if !g.p.Enabled || g.p.Visibility == "hidden" {
		return nil
	}
	week := gamification.WeekStart(g.now).Format(time.DateOnly)
	var joined bool
	if err := g.tx.QueryRow(g.ctx, `SELECT EXISTS (SELECT 1 FROM league_members WHERE user_id = $1 AND week_start = $2::date)`, g.p.UserID, week).Scan(&joined); err != nil || joined {
		return err
	}
	if _, err := g.tx.Exec(g.ctx, `SELECT pg_advisory_xact_lock($1)`, int64(leagueLockKey)); err != nil {
		return err
	}
	var cohortID string
	err := g.tx.QueryRow(g.ctx, `
		SELECT c.id::text FROM league_cohorts c
		WHERE c.week_start = $1::date AND c.tier = $2 AND c.closed_at IS NULL
		  AND (SELECT count(*) FROM league_members m WHERE m.cohort_id = c.id) < $3
		ORDER BY c.created_at LIMIT 1`, week, g.p.LeagueTier, gamification.CohortSize).Scan(&cohortID)
	if errors.Is(err, pgx.ErrNoRows) {
		err = g.tx.QueryRow(g.ctx, `INSERT INTO league_cohorts (week_start, tier) VALUES ($1::date, $2) RETURNING id::text`, week, g.p.LeagueTier).Scan(&cohortID)
	}
	if err != nil {
		return err
	}
	_, err = g.tx.Exec(g.ctx, `INSERT INTO league_members (cohort_id, user_id, week_start) VALUES ($1, $2, $3::date) ON CONFLICT DO NOTHING`, cohortID, g.p.UserID, week)
	return err
}

func (g *gameSession) stats() (gamification.Stats, error) {
	stats := g.trigger
	err := g.tx.QueryRow(g.ctx, `
		SELECT
			count(*) FILTER (WHERE source_kind = 'task' AND quadrant IS NOT NULL),
			count(*) FILTER (WHERE source_kind = 'task' AND quadrant = 'focus'),
			count(*) FILTER (WHERE source_kind = 'task' AND quadrant = 'plan'),
			count(*) FILTER (WHERE source_kind = 'task' AND on_time),
			count(*) FILTER (WHERE source_kind = 'task' AND local_hour < 8),
			count(*) FILTER (WHERE source_kind = 'task' AND local_hour >= 23),
			count(*) FILTER (WHERE source_kind = 'task' AND quadrant IS NOT NULL AND project_id IS NOT NULL),
			count(*) FILTER (WHERE source_kind = 'habit'),
			count(*) FILTER (WHERE source_kind = 'kudos'),
			(SELECT count(*) FROM kudos WHERE from_user_id = $1),
			(SELECT count(*) FROM league_members WHERE user_id = $1 AND outcome = 'promoted')
		FROM xp_events WHERE user_id = $1 AND revoked_at IS NULL`, g.p.UserID).Scan(
		&stats.TasksCompleted, &stats.FocusCompleted, &stats.PlanCompleted, &stats.OnTimeCompleted,
		&stats.EarlyCompletions, &stats.LateCompletions, &stats.ProjectTasks, &stats.HabitCheckIns,
		&stats.KudosReceived, &stats.KudosGiven, &stats.Promotions)
	stats.BestStreak = g.p.Streak.Best
	stats.Level = g.p.Level
	stats.LeagueTier = g.p.LeagueTier
	return stats, err
}

func (g *gameSession) unlockedAchievements() (map[string]bool, error) {
	rows, err := g.tx.Query(g.ctx, `SELECT achievement_id FROM user_achievements WHERE user_id = $1`, g.p.UserID)
	if err != nil {
		return nil, err
	}
	ids, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return nil, err
	}
	have := make(map[string]bool, len(ids))
	for _, id := range ids {
		have[id] = true
	}
	return have, nil
}

// evaluateAchievements unlocks what the latest award earned. An unlock gives
// XP, which can level up and unlock more, so it settles in a few passes.
func (g *gameSession) evaluateAchievements() error {
	for pass := 0; pass < 3; pass++ {
		stats, err := g.stats()
		if err != nil {
			return err
		}
		have, err := g.unlockedAchievements()
		if err != nil {
			return err
		}
		unlocked := gamification.NewlyUnlocked(stats, have)
		if len(unlocked) == 0 {
			return nil
		}
		for _, achievement := range unlocked {
			if err := g.unlock(achievement); err != nil {
				return err
			}
		}
	}
	return nil
}

func (g *gameSession) unlock(achievement gamification.Achievement) error {
	if _, err := g.tx.Exec(g.ctx, `INSERT INTO user_achievements (user_id, achievement_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, g.p.UserID, achievement.ID); err != nil {
		return err
	}
	for _, reward := range []string{achievement.Border, achievement.Title} {
		if reward == "" {
			continue
		}
		if _, err := g.tx.Exec(g.ctx, `INSERT INTO inventory_items (user_id, item_id, source) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, g.p.UserID, reward, "achievement:"+achievement.ID); err != nil {
			return err
		}
		if g.owned != nil {
			g.owned[reward] = true
		}
	}
	amount := gamification.AchievementXP[achievement.Rarity]
	if _, err := g.tx.Exec(g.ctx, `INSERT INTO xp_events (user_id, source_kind, source_id, amount, day) VALUES ($1, 'achievement', $2, $3, $4::date) ON CONFLICT DO NOTHING`, g.p.UserID, achievement.ID, amount, g.today()); err != nil {
		return err
	}
	if err := g.addXP(int64(amount)); err != nil {
		return err
	}
	payload := map[string]any{"id": achievement.ID, "rarity": achievement.Rarity, "xp": amount, "border": achievement.Border, "title": achievement.Title}
	if tier, ok := gamification.AchievementChest(achievement); ok {
		chestID, err := g.grantChest(tier, "achievement", achievement.ID)
		if err != nil {
			return err
		}
		payload["chestId"], payload["chestTier"] = chestID, tier
	}
	if !g.quiet {
		g.emit("achievement_unlocked", payload)
	}
	return nil
}

// withGameSavepoint runs a game update inside the caller's transaction
// without ever failing it: sync must not break because of the game.
func withGameSavepoint(ctx context.Context, tx pgx.Tx, what string, run func() error) {
	if _, err := tx.Exec(ctx, `SAVEPOINT game_award`); err != nil {
		slog.Warn("game award skipped", "what", what, "error", err)
		return
	}
	if err := run(); err != nil {
		_, _ = tx.Exec(ctx, `ROLLBACK TO SAVEPOINT game_award`)
		slog.Warn("game award failed", "what", what, "error", err)
	}
	_, _ = tx.Exec(ctx, `RELEASE SAVEPOINT game_award`)
}

// taskWasCompletedTx reads a task's completion state before a mutation.
func taskWasCompletedTx(ctx context.Context, tx pgx.Tx, taskID uuid.UUID) (bool, error) {
	var completed bool
	err := tx.QueryRow(ctx, `SELECT completed AND deleted_at IS NULL FROM tasks WHERE id = $1`, taskID).Scan(&completed)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	return completed, err
}

// recordTaskGameTx credits or takes back a task completion for the member
// who changed it.
func recordTaskGameTx(ctx context.Context, tx pgx.Tx, userID uuid.UUID, task tasks.Task, taskID uuid.UUID, wasCompleted bool) {
	completed := task.Completed && task.DeletedAt == nil
	if completed == wasCompleted {
		return
	}
	withGameSavepoint(ctx, tx, "task", func() error {
		session, err := beginGameSession(ctx, tx, userID, time.Now())
		if err != nil {
			return err
		}
		if completed {
			err = session.awardTask(task, taskID, task.UpdatedAt)
		} else {
			_, err = session.restoreOrRevoke("task", taskID.String(), true)
		}
		if err != nil {
			return err
		}
		return session.finish()
	})
}

// habitCompletedDatesTx reads a habit's check-in dates before a mutation.
func habitCompletedDatesTx(ctx context.Context, tx pgx.Tx, userID, habitID uuid.UUID) ([]string, error) {
	var raw []byte
	err := tx.QueryRow(ctx, `SELECT completed_dates FROM habits WHERE user_id = $1 AND id = $2 AND deleted_at IS NULL`, userID, habitID).Scan(&raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var dates []string
	if err := json.Unmarshal(raw, &dates); err != nil {
		return nil, err
	}
	return dates, nil
}

// recordHabitGameTx credits new check-ins and takes back removed ones.
func recordHabitGameTx(ctx context.Context, tx pgx.Tx, userID uuid.UUID, habit tasks.Habit, habitID uuid.UUID, before []string) {
	after := habit.CompletedDates
	if habit.DeletedAt != nil {
		return
	}
	previous := map[string]bool{}
	for _, date := range before {
		previous[date] = true
	}
	current := map[string]bool{}
	for _, date := range after {
		current[date] = true
	}
	var added, removed []string
	for date := range current {
		if !previous[date] {
			added = append(added, date)
		}
	}
	for date := range previous {
		if !current[date] {
			removed = append(removed, date)
		}
	}
	if len(added) == 0 && len(removed) == 0 {
		return
	}
	// Oldest first: a streak only grows forward in time.
	slices.Sort(added)
	withGameSavepoint(ctx, tx, "habit", func() error {
		session, err := beginGameSession(ctx, tx, userID, time.Now())
		if err != nil {
			return err
		}
		for _, date := range removed {
			if _, err := session.restoreOrRevoke("habit", habitID.String()+":"+date, true); err != nil {
				return err
			}
		}
		for _, date := range added {
			if err := session.awardHabitCheckIn(habitID, date, after); err != nil {
				return err
			}
		}
		return session.finish()
	})
}

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}
