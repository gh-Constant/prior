package store

import (
	"context"
	"errors"
	"slices"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestGameSocialPostgres(t *testing.T) {
	s, pool := newGameTestStore(t)
	ctx := context.Background()
	alice := newGameTestUser(t, s, "alice@game.test")
	bob := newGameTestUser(t, s, "bob@game.test")

	projectID := uuid.New()
	if _, err := pool.Exec(ctx, `INSERT INTO projects (id, user_id, name, icon, created_at, updated_at) VALUES ($1, $2, 'Launch', 'rocket', now(), now())`, projectID, alice.id); err != nil {
		t.Fatal(err)
	}

	// Invite preview: what the invite landing shows before sign-in.
	_, carolInvite, err := s.ShareProject(ctx, alice.id, projectID, "carol@game.test", "editor")
	if err != nil || carolInvite == nil || carolInvite.InviteToken == "" {
		t.Fatalf("invite for a new person: %+v %v", carolInvite, err)
	}
	preview, err := s.InvitePreview(ctx, carolInvite.InviteToken)
	if err != nil || preview.ProjectName != "Launch" || preview.ProjectIcon != "rocket" || preview.InviterName != "Player" || preview.MemberCount != 1 || preview.Status != "pending" {
		t.Fatalf("InvitePreview: %+v %v", preview, err)
	}
	if _, err := s.InvitePreview(ctx, "not-a-token"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("a bad token reveals nothing: %v", err)
	}
	_, bobInvite, err := s.ShareProject(ctx, alice.id, projectID, "bob@game.test", "editor")
	if err != nil || bobInvite == nil {
		t.Fatalf("invite bob: %+v %v", bobInvite, err)
	}
	if _, err := s.AcceptProjectInvite(ctx, bob.id, bobInvite.InviteToken); err != nil {
		t.Fatal(err)
	}
	if preview, _ := s.InvitePreview(ctx, bobInvite.InviteToken); preview.Status != "accepted" || preview.MemberCount != 2 {
		t.Fatalf("after acceptance: %+v", preview)
	}

	enabled, public, hidden := true, "public", "hidden"
	if _, err := s.UpdateGameSettings(ctx, alice.id, GameSettings{Enabled: &enabled, Visibility: &public}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.UpdateGameSettings(ctx, bob.id, GameSettings{Enabled: &enabled, Visibility: &hidden}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.SetGameHandle(ctx, alice.id, "alice"); err != nil {
		t.Fatal(err)
	}

	alice.complete(alice.task(), true)
	shared := bob.task()
	project := projectID.String()
	shared.ProjectID = &project
	shared = bob.complete(shared, true)

	// Global boards show visible players only, by handle.
	board, err := s.GameLeaderboard(ctx, alice.id, "level", 10)
	if err != nil || len(board.Players) != 1 || board.Players[0].Handle == nil || *board.Players[0].Handle != "alice" || board.Me == nil || !board.Me.IsMe {
		t.Fatalf("level board: %+v %v", board, err)
	}
	if board, _ := s.GameLeaderboard(ctx, bob.id, "streak", 10); board.Me != nil || len(board.Players) != 1 || board.Players[0].Streak != 1 {
		t.Fatalf("hidden players see the board without appearing: %+v", board)
	}
	if _, err := s.GameLeaderboard(ctx, bob.id, "money", 10); !errors.Is(err, ErrInvalidGameSettings) {
		t.Fatalf("unknown board: %v", err)
	}

	// Kudos: for someone else's work on a shared project, once.
	if err := s.GiveKudos(ctx, alice.id, uuid.MustParse(shared.ID)); err != nil {
		t.Fatal(err)
	}
	if err := s.GiveKudos(ctx, alice.id, uuid.MustParse(shared.ID)); err != nil {
		t.Fatal(err)
	}
	if err := s.GiveKudos(ctx, bob.id, uuid.MustParse(shared.ID)); !errors.Is(err, ErrKudosNotAllowed) {
		t.Fatalf("no kudos for yourself: %v", err)
	}
	personal := alice.complete(alice.task(), true)
	if err := s.GiveKudos(ctx, bob.id, uuid.MustParse(personal.ID)); !errors.Is(err, ErrKudosNotAllowed) {
		t.Fatalf("no kudos outside shared projects: %v", err)
	}
	bobState := bob.state()
	kinds := eventKinds(bobState.Events)
	kudosEvents := 0
	for _, kind := range kinds {
		if kind == "kudos_received" {
			kudosEvents++
		}
	}
	if kudosEvents != 1 {
		t.Fatalf("one kudos celebration: %v", kinds)
	}

	// Project leaderboards: the owner picks the mode, members opt in.
	board2, err := s.ProjectLeaderboard(ctx, bob.id, projectID, time.Now())
	if err != nil || board2.Mode != "off" || board2.IsOwner || board2.MyChoice != nil {
		t.Fatalf("default project board: %+v %v", board2, err)
	}
	if err := s.SetProjectLeaderboard(ctx, bob.id, projectID, "team", 500); !errors.Is(err, ErrNotProjectOwner) {
		t.Fatalf("members cannot change the mode: %v", err)
	}
	if err := s.SetProjectLeaderboard(ctx, alice.id, projectID, "team", 500); err != nil {
		t.Fatal(err)
	}
	if err := s.SetProjectLeaderboardChoice(ctx, bob.id, projectID, true); err != nil {
		t.Fatal(err)
	}
	board2, err = s.ProjectLeaderboard(ctx, alice.id, projectID, time.Now())
	if err != nil || board2.Mode != "team" || board2.TeamGoalXP != 500 || !board2.IsOwner || len(board2.Members) != 1 {
		t.Fatalf("team board: %+v %v", board2, err)
	}
	// Bob's project XP: 30 for the task, 5 for alice's kudos.
	if member := board2.Members[0]; member.DisplayName != "Player" || member.WeeklyXP != 35 || board2.TeamWeeklyXP != 35 || member.IsMe {
		t.Fatalf("bob on the team board: %+v", member)
	}
	outsider := newGameTestUser(t, s, "outsider@game.test")
	if _, err := s.ProjectLeaderboard(ctx, outsider.id, projectID, time.Now()); !errors.Is(err, ErrNotFound) {
		t.Fatalf("outsiders cannot see a project board: %v", err)
	}

	// Leagues: visible players join a cohort with their first XP of the week.
	league, err := s.GameLeague(ctx, alice.id, time.Now())
	if err != nil || !league.Joined || len(league.Members) != 1 || league.Members[0].WeeklyXP == 0 || league.Tier != "pebble" {
		t.Fatalf("alice's league: %+v %v", league, err)
	}
	if league, _ := s.GameLeague(ctx, bob.id, time.Now()); league.Joined {
		t.Fatal("hidden players stay out of leagues")
	}
	closed, err := s.CloseLeagueWeeks(ctx, time.Now().AddDate(0, 0, 8))
	if err != nil || closed != 1 {
		t.Fatalf("CloseLeagueWeeks: %d %v", closed, err)
	}
	if again, err := s.CloseLeagueWeeks(ctx, time.Now().AddDate(0, 0, 8)); err != nil || again != 0 {
		t.Fatalf("a week closes once: %d %v", again, err)
	}
	after := alice.state()
	if after.Profile.LeagueTier != "bronze" || !slices.Contains(eventKinds(after.Events), "league_result") {
		t.Fatalf("alice is promoted: %s %v", after.Profile.LeagueTier, eventKinds(after.Events))
	}
	rising := slices.IndexFunc(after.Achievements, func(a GameAchievement) bool { return a.ID == "rising" })
	if after.Achievements[rising].UnlockedAt == nil {
		t.Fatal("a first promotion unlocks rising")
	}
}
