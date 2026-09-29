package store

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"slices"
	"strings"
	"time"

	"github.com/gh-Constant/prior/server/internal/gamification"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// leagueCloseLockKey lets one API replica close finished league weeks.
const leagueCloseLockKey = 90733102

var (
	ErrKudosNotAllowed = errors.New("kudos not allowed")
	ErrNotProjectOwner = errors.New("only the project owner can change this")
)

// GamePlayer is how a player appears to others: a handle or an anonymous
// animal, never an email or a real name.
type GamePlayer struct {
	Position   int               `json:"position"`
	Handle     *string           `json:"handle"`
	Anonymous  string            `json:"anonymous,omitempty"`
	Level      int               `json:"level"`
	Rank       string            `json:"rank"`
	XP         int64             `json:"xp"`
	Streak     int               `json:"streak"`
	LeagueTier string            `json:"leagueTier"`
	Equipped   map[string]string `json:"equipped"`
	Pet        *GamePetAvatar    `json:"pet"`
	IsMe       bool              `json:"isMe"`
}

type GamePetAvatar struct {
	Species string `json:"species"`
	Stage   string `json:"stage"`
}

// publicEquipped keeps only what others may see.
func publicEquipped(raw []byte) map[string]string {
	all := map[string]string{}
	_ = json.Unmarshal(raw, &all)
	visible := map[string]string{}
	for _, slot := range []string{gamification.NameEffectSlot, "border", "title", "petHat"} {
		if value := all[slot]; value != "" {
			visible[slot] = value
		}
	}
	return visible
}

func petAvatar(species *string, hatchedAt *time.Time, level int) *GamePetAvatar {
	if species == nil || hatchedAt == nil {
		return nil
	}
	return &GamePetAvatar{Species: *species, Stage: string(gamification.PetStageFor(level, true))}
}

func tierName(index int) string {
	return gamification.LeagueTiers[min(max(index, 0), len(gamification.LeagueTiers)-1)]
}

const playerColumns = `p.user_id, p.handle, p.anonymous_key, p.visibility, p.xp, p.level, p.league_tier, p.equipped, p.pet_species, p.pet_hatched_at,
	CASE WHEN p.streak_last_day >= (now() AT TIME ZONE p.time_zone)::date - 1 - p.streak_freezes THEN p.streak_current ELSE 0 END`

func scanPlayer(row pgx.Row, viewer uuid.UUID, extra ...any) (GamePlayer, error) {
	var player GamePlayer
	var userID uuid.UUID
	var anonymousKey, visibility string
	var equipped []byte
	var species *string
	var hatchedAt *time.Time
	var tier int
	targets := append([]any{&userID, &player.Handle, &anonymousKey, &visibility, &player.XP, &player.Level, &tier, &equipped, &species, &hatchedAt, &player.Streak}, extra...)
	if err := row.Scan(targets...); err != nil {
		return player, err
	}
	if visibility != "public" {
		player.Handle, player.Anonymous = nil, anonymousKey
	}
	player.Rank = gamification.RankFor(player.Level)
	player.LeagueTier = tierName(tier)
	player.Equipped = publicEquipped(equipped)
	player.Pet = petAvatar(species, hatchedAt, player.Level)
	player.IsMe = userID == viewer
	return player, nil
}

type GameBoard struct {
	Board   string       `json:"board"`
	Players []GamePlayer `json:"players"`
	// Me is the viewer's own entry, also when outside the top players.
	// It is nil when the viewer is hidden or in Calm mode.
	Me *GamePlayer `json:"me"`
}

// GameLeaderboard ranks visible gamified players all-time by level ("level")
// or by live streak ("streak").
func (s *Store) GameLeaderboard(ctx context.Context, viewer uuid.UUID, board string, limit int) (GameBoard, error) {
	metric := "p.xp"
	switch board {
	case "level":
	case "streak":
		metric = "CASE WHEN p.streak_last_day >= (now() AT TIME ZONE p.time_zone)::date - 1 - p.streak_freezes THEN p.streak_current ELSE 0 END"
	default:
		return GameBoard{}, ErrInvalidGameSettings
	}
	limit = min(max(limit, 1), 100)
	result := GameBoard{Board: board, Players: []GamePlayer{}}
	rows, err := s.pool.Query(ctx, `SELECT `+playerColumns+`, `+metric+` AS metric FROM game_profiles p
		WHERE p.enabled AND p.visibility <> 'hidden' ORDER BY metric DESC, p.xp DESC, p.user_id LIMIT $1`, limit)
	if err != nil {
		return result, err
	}
	for rows.Next() {
		var metricValue int64
		player, err := scanPlayer(rows, viewer, &metricValue)
		if err != nil {
			rows.Close()
			return result, err
		}
		player.Position = len(result.Players) + 1
		result.Players = append(result.Players, player)
		if player.IsMe {
			me := player
			result.Me = &me
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil || result.Me != nil {
		return result, err
	}
	var myMetric int64
	me, err := scanPlayer(s.pool.QueryRow(ctx, `SELECT `+playerColumns+`, `+metric+` FROM game_profiles p WHERE p.user_id = $1 AND p.enabled AND p.visibility <> 'hidden'`, viewer), viewer, &myMetric)
	if errors.Is(err, pgx.ErrNoRows) {
		return result, nil
	}
	if err != nil {
		return result, err
	}
	if err := s.pool.QueryRow(ctx, `SELECT count(*) + 1 FROM game_profiles p WHERE p.enabled AND p.visibility <> 'hidden' AND `+metric+` > $1`, myMetric).Scan(&me.Position); err != nil {
		return result, err
	}
	result.Me = &me
	return result, nil
}

type GameLeagueMember struct {
	GamePlayer
	WeeklyXP int64 `json:"weeklyXp"`
}

type GameLeagueResult struct {
	Outcome string `json:"outcome"`
	Rank    int    `json:"rank"`
	Tier    string `json:"tier"`
}

type GameLeague struct {
	Tier      string             `json:"tier"`
	TierIndex int                `json:"tierIndex"`
	WeekStart time.Time          `json:"weekStart"`
	EndsAt    time.Time          `json:"endsAt"`
	Joined    bool               `json:"joined"`
	Promote   int                `json:"promote"`
	Demote    int                `json:"demote"`
	Members   []GameLeagueMember `json:"members"`
	Last      *GameLeagueResult  `json:"lastResult"`
}

// GameLeague shows the viewer's cohort for the current week. Players join
// with their first league XP of the week, so an empty league is normal.
func (s *Store) GameLeague(ctx context.Context, viewer uuid.UUID, now time.Time) (GameLeague, error) {
	week := gamification.WeekStart(now)
	league := GameLeague{WeekStart: week, EndsAt: week.AddDate(0, 0, 7), Members: []GameLeagueMember{}}
	if err := s.pool.QueryRow(ctx, `SELECT league_tier FROM game_profiles WHERE user_id = $1`, viewer).Scan(&league.TierIndex); err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return league, err
	}
	league.Tier = tierName(league.TierIndex)
	var last GameLeagueResult
	var lastTier int
	err := s.pool.QueryRow(ctx, `SELECT m.outcome, m.final_rank, c.tier FROM league_members m JOIN league_cohorts c ON c.id = m.cohort_id
		WHERE m.user_id = $1 AND m.outcome IS NOT NULL ORDER BY m.week_start DESC LIMIT 1`, viewer).Scan(&last.Outcome, &last.Rank, &lastTier)
	if err == nil {
		last.Tier = tierName(lastTier)
		league.Last = &last
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return league, err
	}
	var cohortID uuid.UUID
	err = s.pool.QueryRow(ctx, `SELECT cohort_id FROM league_members WHERE user_id = $1 AND week_start = $2::date`, viewer, week.Format(time.DateOnly)).Scan(&cohortID)
	if errors.Is(err, pgx.ErrNoRows) {
		return league, nil
	}
	if err != nil {
		return league, err
	}
	league.Joined = true
	rows, err := s.pool.Query(ctx, `SELECT `+playerColumns+`,
			COALESCE((SELECT SUM(e.amount) FROM xp_events e WHERE e.user_id = m.user_id AND e.occurred_at >= $2 AND e.occurred_at < $3 AND e.revoked_at IS NULL AND NOT e.backfill), 0) AS weekly
		FROM league_members m JOIN game_profiles p ON p.user_id = m.user_id
		WHERE m.cohort_id = $1 ORDER BY weekly DESC, m.joined_at`, cohortID, week, league.EndsAt)
	if err != nil {
		return league, err
	}
	defer rows.Close()
	for rows.Next() {
		var member GameLeagueMember
		player, err := scanPlayer(rows, viewer, &member.WeeklyXP)
		if err != nil {
			return league, err
		}
		player.Position = len(league.Members) + 1
		member.GamePlayer = player
		league.Members = append(league.Members, member)
	}
	league.Promote, league.Demote = gamification.Zones(len(league.Members))
	return league, rows.Err()
}

// CloseLeagueWeeks settles every cohort of a finished week: ranks, promotions
// and demotions, new tiers and a result celebration for each player. Only one
// replica runs it at a time.
func (s *Store) CloseLeagueWeeks(ctx context.Context, now time.Time) (int, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)
	var locked bool
	if err := tx.QueryRow(ctx, `SELECT pg_try_advisory_xact_lock($1)`, int64(leagueCloseLockKey)).Scan(&locked); err != nil || !locked {
		return 0, err
	}
	rows, err := tx.Query(ctx, `SELECT id, week_start, tier FROM league_cohorts WHERE closed_at IS NULL AND week_start < $1::date ORDER BY week_start, id`, gamification.WeekStart(now).Format(time.DateOnly))
	if err != nil {
		return 0, err
	}
	type cohort struct {
		id   uuid.UUID
		week time.Time
		tier int
	}
	var cohorts []cohort
	for rows.Next() {
		var c cohort
		if err := rows.Scan(&c.id, &c.week, &c.tier); err != nil {
			rows.Close()
			return 0, err
		}
		cohorts = append(cohorts, c)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, err
	}
	for _, c := range cohorts {
		if err := closeCohortTx(ctx, tx, c.id, c.week, c.tier, now); err != nil {
			return 0, err
		}
	}
	return len(cohorts), tx.Commit(ctx)
}

func closeCohortTx(ctx context.Context, tx pgx.Tx, cohortID uuid.UUID, week time.Time, tier int, now time.Time) error {
	rows, err := tx.Query(ctx, `SELECT m.user_id::text, m.joined_at,
			COALESCE((SELECT SUM(e.amount) FROM xp_events e WHERE e.user_id = m.user_id AND e.occurred_at >= $2 AND e.occurred_at < $3 AND e.revoked_at IS NULL AND NOT e.backfill), 0)
		FROM league_members m WHERE m.cohort_id = $1`, cohortID, week, week.AddDate(0, 0, 7))
	if err != nil {
		return err
	}
	var entries []gamification.LeagueEntry
	for rows.Next() {
		var entry gamification.LeagueEntry
		if err := rows.Scan(&entry.UserID, &entry.JoinedAt, &entry.WeeklyXP); err != nil {
			rows.Close()
			return err
		}
		entries = append(entries, entry)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	for _, result := range gamification.CloseCohort(tier, entries) {
		if _, err := tx.Exec(ctx, `UPDATE league_members SET final_rank = $3, outcome = $4 WHERE cohort_id = $1 AND user_id = $2`, cohortID, result.UserID, result.Rank, result.Outcome); err != nil {
			return err
		}
		userID, err := uuid.Parse(result.UserID)
		if err != nil {
			return err
		}
		session, err := beginGameSession(ctx, tx, userID, now)
		if err != nil {
			return err
		}
		session.p.LeagueTier = result.Tier
		session.emit("league_result", map[string]any{"outcome": result.Outcome, "rank": result.Rank, "from": tierName(tier), "to": tierName(result.Tier)})
		if err := session.evaluateAchievements(); err != nil {
			return err
		}
		if err := session.finish(); err != nil {
			return err
		}
	}
	_, err = tx.Exec(ctx, `UPDATE league_cohorts SET closed_at = now() WHERE id = $1`, cohortID)
	return err
}

type ProjectLeaderboardEntry struct {
	UserID      string            `json:"userId"`
	DisplayName string            `json:"displayName"`
	AvatarURL   string            `json:"avatarUrl"`
	Level       int               `json:"level"`
	Equipped    map[string]string `json:"equipped"`
	Pet         *GamePetAvatar    `json:"pet"`
	WeeklyXP    int64             `json:"weeklyXp"`
	TotalXP     int64             `json:"totalXp"`
	IsMe        bool              `json:"isMe"`
}

type ProjectLeaderboard struct {
	Mode         string                    `json:"mode"`
	TeamGoalXP   int                       `json:"teamGoalXp"`
	IsOwner      bool                      `json:"isOwner"`
	MyChoice     *bool                     `json:"myChoice"`
	WeekStart    time.Time                 `json:"weekStart"`
	TeamWeeklyXP int64                     `json:"teamWeeklyXp"`
	Members      []ProjectLeaderboardEntry `json:"members"`
}

// ProjectLeaderboard shows the XP members earned on a project's tasks. Only
// gamified members who chose to join appear, under their real project name.
func (s *Store) ProjectLeaderboard(ctx context.Context, viewer, projectID uuid.UUID, now time.Time) (ProjectLeaderboard, error) {
	role, err := s.projectRoleFromPool(ctx, viewer, projectID)
	if err != nil {
		return ProjectLeaderboard{}, err
	}
	week := gamification.WeekStart(now)
	board := ProjectLeaderboard{Mode: "off", IsOwner: role == "owner", WeekStart: week, Members: []ProjectLeaderboardEntry{}}
	if err := s.pool.QueryRow(ctx, `SELECT mode, team_goal_xp FROM project_game_settings WHERE project_id = $1`, projectID).Scan(&board.Mode, &board.TeamGoalXP); err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return board, err
	}
	var choice bool
	if err := s.pool.QueryRow(ctx, `SELECT joined FROM project_leaderboard_optins WHERE project_id = $1 AND user_id = $2`, projectID, viewer).Scan(&choice); err == nil {
		board.MyChoice = &choice
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return board, err
	}
	if board.Mode == "off" {
		return board, nil
	}
	rows, err := s.pool.Query(ctx, `
		SELECT u.id, COALESCE(NULLIF(u.display_name, ''), split_part(u.email, '@', 1)), u.avatar_url, p.level, p.equipped, p.pet_species, p.pet_hatched_at,
			COALESCE(SUM(e.amount) FILTER (WHERE e.occurred_at >= $2), 0), COALESCE(SUM(e.amount), 0)
		FROM project_leaderboard_optins o
		JOIN users u ON u.id = o.user_id
		JOIN game_profiles p ON p.user_id = o.user_id AND p.enabled
		LEFT JOIN xp_events e ON e.user_id = o.user_id AND e.project_id = o.project_id AND e.revoked_at IS NULL
		WHERE o.project_id = $1 AND o.joined
		  AND (EXISTS (SELECT 1 FROM projects pr WHERE pr.id = $1 AND pr.user_id = o.user_id)
		       OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = $1 AND pm.user_id = o.user_id AND pm.status = 'active'))
		GROUP BY u.id, u.display_name, u.email, u.avatar_url, p.level, p.equipped, p.pet_species, p.pet_hatched_at
		ORDER BY 8 DESC, 9 DESC, u.id`, projectID, week)
	if err != nil {
		return board, err
	}
	defer rows.Close()
	for rows.Next() {
		var entry ProjectLeaderboardEntry
		var userID uuid.UUID
		var equipped []byte
		var species *string
		var hatchedAt *time.Time
		if err := rows.Scan(&userID, &entry.DisplayName, &entry.AvatarURL, &entry.Level, &equipped, &species, &hatchedAt, &entry.WeeklyXP, &entry.TotalXP); err != nil {
			return board, err
		}
		entry.UserID = userID.String()
		entry.IsMe = userID == viewer
		entry.Equipped = publicEquipped(equipped)
		entry.Pet = petAvatar(species, hatchedAt, entry.Level)
		board.TeamWeeklyXP += entry.WeeklyXP
		board.Members = append(board.Members, entry)
	}
	return board, rows.Err()
}

// SetProjectLeaderboard lets the owner choose off, competitive or team.
func (s *Store) SetProjectLeaderboard(ctx context.Context, userID, projectID uuid.UUID, mode string, teamGoalXP int) error {
	if !slices.Contains([]string{"off", "competitive", "team"}, mode) || teamGoalXP < 0 || teamGoalXP > 1_000_000 {
		return ErrInvalidGameSettings
	}
	role, err := s.projectRoleFromPool(ctx, userID, projectID)
	if err != nil {
		return err
	}
	if role != "owner" {
		return ErrNotProjectOwner
	}
	_, err = s.pool.Exec(ctx, `
		INSERT INTO project_game_settings (project_id, mode, team_goal_xp) VALUES ($1, $2, $3)
		ON CONFLICT (project_id) DO UPDATE SET mode = EXCLUDED.mode, team_goal_xp = EXCLUDED.team_goal_xp, updated_at = now()`, projectID, mode, teamGoalXP)
	return err
}

// SetProjectLeaderboardChoice records whether a member appears on a project's leaderboard.
func (s *Store) SetProjectLeaderboardChoice(ctx context.Context, userID, projectID uuid.UUID, joined bool) error {
	if _, err := s.projectRoleFromPool(ctx, userID, projectID); err != nil {
		return err
	}
	_, err := s.pool.Exec(ctx, `
		INSERT INTO project_leaderboard_optins (project_id, user_id, joined) VALUES ($1, $2, $3)
		ON CONFLICT (project_id, user_id) DO UPDATE SET joined = EXCLUDED.joined, decided_at = now()`, projectID, userID, joined)
	return err
}

// GiveKudos thanks the teammate who completed a shared-project task. Each
// person can give kudos once per task; the receiver's kudos XP is capped daily.
func (s *Store) GiveKudos(ctx context.Context, fromUserID, taskID uuid.UUID) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var toUserID uuid.UUID
	var projectID *uuid.UUID
	err = tx.QueryRow(ctx, `SELECT user_id, project_id FROM xp_events WHERE source_kind = 'task' AND source_id = $1 AND revoked_at IS NULL LIMIT 1`, taskID.String()).Scan(&toUserID, &projectID)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrKudosNotAllowed
	}
	if err != nil {
		return err
	}
	// Kudos are for someone else's work on a shared project.
	if projectID == nil || toUserID == fromUserID {
		return ErrKudosNotAllowed
	}
	if _, err := projectRoleTx(ctx, tx, fromUserID, *projectID); err != nil {
		return ErrKudosNotAllowed
	}
	tag, err := tx.Exec(ctx, `INSERT INTO kudos (from_user_id, task_id, to_user_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, fromUserID, taskID, toUserID)
	if err != nil || tag.RowsAffected() == 0 {
		return err
	}
	// Lock both profiles in a stable order so crossed kudos cannot deadlock.
	first, second := fromUserID, toUserID
	if strings.Compare(first.String(), second.String()) > 0 {
		first, second = second, first
	}
	sessions := map[uuid.UUID]*gameSession{}
	for _, id := range []uuid.UUID{first, second} {
		session, err := beginGameSession(ctx, tx, id, time.Now())
		if err != nil {
			return err
		}
		sessions[id] = session
	}
	receiver, giver := sessions[toUserID], sessions[fromUserID]
	var receivedToday int
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM xp_events WHERE user_id = $1 AND source_kind = 'kudos' AND day = $2::date`, toUserID, receiver.today()).Scan(&receivedToday); err != nil {
		return err
	}
	amount := gamification.KudosAward(receivedToday)
	if _, err := tx.Exec(ctx, `INSERT INTO xp_events (user_id, source_kind, source_id, project_id, amount, day) VALUES ($1, 'kudos', $2, $3, $4, $5::date)`,
		toUserID, fromUserID.String()+":"+taskID.String(), projectID, amount, receiver.today()); err != nil {
		return err
	}
	if err := receiver.addXP(int64(amount)); err != nil {
		return err
	}
	var fromName, taskTitle string
	if err := tx.QueryRow(ctx, `SELECT COALESCE(NULLIF(u.display_name, ''), split_part(u.email, '@', 1)), COALESCE((SELECT title FROM tasks WHERE id = $2), '') FROM users u WHERE u.id = $1`, fromUserID, taskID).Scan(&fromName, &taskTitle); err != nil {
		return err
	}
	receiver.emit("kudos_received", map[string]any{"from": fromName, "task": taskTitle, "xp": amount})
	for _, session := range []*gameSession{receiver, giver} {
		if err := session.evaluateAchievements(); err != nil {
			return err
		}
		if err := session.finish(); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

// InvitePreview describes a pending invite to someone who may not have an
// account yet. The token is the capability: nothing personal beyond the
// inviter's display name is returned.
type InvitePreview struct {
	ProjectName string `json:"projectName"`
	ProjectIcon string `json:"projectIcon"`
	InviterName string `json:"inviterName"`
	AvatarURL   string `json:"inviterAvatarUrl"`
	MemberCount int    `json:"memberCount"`
	Role        string `json:"role"`
	Status      string `json:"status"` // pending, accepted or expired
}

func (s *Store) InvitePreview(ctx context.Context, token string) (InvitePreview, error) {
	rawToken, err := hex.DecodeString(strings.TrimSpace(token))
	if err != nil || len(rawToken) != 32 {
		return InvitePreview{}, ErrNotFound
	}
	hash := sha256.Sum256(rawToken)
	var preview InvitePreview
	var icon *string
	var expiresAt time.Time
	var acceptedAt *time.Time
	err = s.pool.QueryRow(ctx, `
		SELECT p.name, p.icon, COALESCE(NULLIF(u.display_name, ''), split_part(u.email, '@', 1)), u.avatar_url, i.role, i.expires_at, i.accepted_at,
			1 + (SELECT count(*) FROM project_members pm WHERE pm.project_id = p.id AND pm.status = 'active' AND pm.user_id <> p.user_id)
		FROM project_invites i
		JOIN projects p ON p.id = i.project_id AND p.deleted_at IS NULL
		JOIN users u ON u.id = i.inviter_user_id
		WHERE i.token_hash = $1`, hash[:]).Scan(&preview.ProjectName, &icon, &preview.InviterName, &preview.AvatarURL, &preview.Role, &expiresAt, &acceptedAt, &preview.MemberCount)
	if errors.Is(err, pgx.ErrNoRows) {
		return InvitePreview{}, ErrNotFound
	}
	if err != nil {
		return InvitePreview{}, err
	}
	if icon != nil {
		preview.ProjectIcon = *icon
	}
	switch {
	case acceptedAt != nil:
		preview.Status = "accepted"
	case time.Now().After(expiresAt):
		preview.Status = "expired"
	default:
		preview.Status = "pending"
	}
	return preview, nil
}
