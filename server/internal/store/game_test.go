package store

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/gh-Constant/prior/server/internal/database"
	"github.com/gh-Constant/prior/server/internal/gamification"
	"github.com/gh-Constant/prior/server/internal/tasks"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func newGameTestStore(t *testing.T) (*Store, *pgxpool.Pool) {
	t.Helper()
	url := os.Getenv("PRIOR_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("set PRIOR_TEST_DATABASE_URL for PostgreSQL integration")
	}
	ctx := context.Background()
	admin, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(admin.Close)
	schema := "game_test_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if _, err = admin.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = admin.Exec(context.Background(), "DROP SCHEMA "+schema+" CASCADE") })
	config, err := pgxpool.ParseConfig(url)
	if err != nil {
		t.Fatal(err)
	}
	config.ConnConfig.RuntimeParams["search_path"] = schema + ",public"
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	if err = database.Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	return New(pool), pool
}

type gameTestUser struct {
	t   *testing.T
	s   *Store
	id  uuid.UUID
	loc *time.Location
}

// noonZone is a fixed-offset zone where it is about midday right now, so
// time-of-day achievements (early bird, night owl) never fire by accident.
func noonZone(t *testing.T) (string, *time.Location) {
	t.Helper()
	offset := 12 - time.Now().UTC().Hour()
	name := fmt.Sprintf("Etc/GMT%+d", -offset)
	location, err := time.LoadLocation(name)
	if err != nil {
		t.Skipf("no tzdata for %s", name)
	}
	return name, location
}

func newGameTestUser(t *testing.T, s *Store, email string) gameTestUser {
	t.Helper()
	ctx := context.Background()
	user, err := s.CreatePasswordUser(ctx, email, "hash", "Player")
	if err != nil {
		t.Fatal(err)
	}
	zone, location := noonZone(t)
	if _, err := s.UpdateGameSettings(ctx, user.ID, GameSettings{TimeZone: &zone}); err != nil {
		t.Fatal(err)
	}
	return gameTestUser{t: t, s: s, id: user.ID, loc: location}
}

// day is a calendar day in the user's zone, relative to today.
func (u gameTestUser) day(offset int) string {
	return time.Now().In(u.loc).AddDate(0, 0, offset).Format(time.DateOnly)
}

// task builds a Focus task created an hour ago.
func (u gameTestUser) task() tasks.Task {
	now := time.Now().UTC()
	return tasks.Task{ID: uuid.NewString(), Title: "work", Priority: 4, Status: "next", Important: true, Urgent: true, CreatedAt: now.Add(-time.Hour), UpdatedAt: now.Add(-time.Hour)}
}

func (u gameTestUser) push(task tasks.Task) tasks.Task {
	u.t.Helper()
	task.UpdatedAt = time.Now().UTC()
	results, err := u.s.Push(context.Background(), u.id, []tasks.Mutation{{ID: uuid.NewString(), Kind: "upsert", Task: task}})
	if err != nil {
		u.t.Fatal(err)
	}
	if len(results) != 1 || !results[0].OK {
		u.t.Fatalf("push failed: %+v", results[0].Error)
	}
	return task
}

func (u gameTestUser) complete(task tasks.Task, completed bool) tasks.Task {
	task.Completed = completed
	return u.push(task)
}

func (u gameTestUser) state() GameState {
	u.t.Helper()
	state, err := u.s.GameState(context.Background(), u.id)
	if err != nil {
		u.t.Fatal(err)
	}
	return state
}

func eventKinds(events []GameEvent) []string {
	kinds := make([]string, 0, len(events))
	for _, event := range events {
		kinds = append(kinds, event.Kind)
	}
	return kinds
}

func TestGameXPFollowsCompletionPostgres(t *testing.T) {
	s, _ := newGameTestStore(t)
	user := newGameTestUser(t, s, "xp@game.test")

	task := user.push(user.task())
	if xp := user.state().Profile.XP; xp != 0 {
		t.Fatalf("an open task earns nothing, got %d", xp)
	}
	task = user.complete(task, true)
	// 30 for the Focus task, 25 for the first-step achievement.
	if profile := user.state().Profile; profile.TodayTaskXP != 30 || profile.XP != 55 {
		t.Fatalf("first Focus completion: task XP %d, total %d", profile.TodayTaskXP, profile.XP)
	}
	task = user.complete(task, false)
	if profile := user.state().Profile; profile.TodayTaskXP != 0 || profile.XP != 25 {
		t.Fatalf("un-completing takes the task XP back, achievements stay: %+v", profile)
	}
	user.complete(task, true)
	user.complete(task, true)
	state := user.state()
	if state.Profile.XP != 55 || state.Profile.TodayTaskXP != 30 {
		t.Fatalf("re-completing restores exactly once: %+v", state.Profile)
	}
	if state.Profile.Enabled || len(state.Events) != 0 {
		t.Fatal("a Calm account records XP silently")
	}

	farmed := user.task()
	farmed.CreatedAt = time.Now().UTC()
	farmed.Completed = true
	user.push(farmed)
	if profile := user.state().Profile; profile.TodayTaskXP != 31 {
		t.Fatalf("an instant completion earns 1, got task XP %d", profile.TodayTaskXP)
	}
}

func TestGameActivationBackfillHatchAndChestsPostgres(t *testing.T) {
	s, pool := newGameTestStore(t)
	ctx := context.Background()
	user := newGameTestUser(t, s, "activate@game.test")

	// History from before the ledger existed: two completed Plan tasks.
	old := time.Now().UTC().Add(-72 * time.Hour)
	for range 2 {
		if _, err := pool.Exec(ctx, `INSERT INTO tasks (id, user_id, title, priority, status, completed, important, urgent, created_at, updated_at, revision) VALUES ($1, $2, 'old', 4, 'done', TRUE, TRUE, FALSE, $3, $4, 1)`, uuid.New(), user.id, old.Add(-time.Hour), old); err != nil {
			t.Fatal(err)
		}
	}
	enabled, version, visibility := true, OnboardingVersion, "public"
	profile, err := s.UpdateGameSettings(ctx, user.id, GameSettings{Enabled: &enabled, OnboardingVersion: &version, Visibility: &visibility})
	if err != nil {
		t.Fatal(err)
	}
	// 2 × 25 backfilled, 25 for first-step.
	if profile.XP != 75 || profile.Progress.Level != 2 || profile.Pet == nil || profile.Pet.Stage != "egg" || profile.Equipped["border"] != "border-common-ring" {
		t.Fatalf("activation: %+v pet=%+v", profile, profile.Pet)
	}
	if again, err := s.UpdateGameSettings(ctx, user.id, GameSettings{Enabled: &enabled}); err != nil || again.XP != 75 {
		t.Fatalf("activating again never backfills twice: %+v %v", again, err)
	}

	first := user.complete(user.task(), true)
	state := user.state()
	// + 30 Focus + 30 welcome bonus: level 3.
	if state.Profile.XP != 135 || state.Profile.Progress.Level != 3 {
		t.Fatalf("after the first completion: %+v", state.Profile)
	}
	if state.Profile.Pet.Species == nil || state.Profile.Pet.Stage != "baby" {
		t.Fatalf("the egg hatches on the first completion: %+v", state.Profile.Pet)
	}
	kinds := strings.Join(eventKinds(state.Events), ",")
	if kinds != "backfill,pet_hatched,level_up" {
		t.Fatalf("events = %s", kinds)
	}
	if len(state.Chests) != 2 || state.Chests[0].SourceRef != "2" || state.Chests[1].SourceRef != "3" {
		t.Fatalf("one chest per level reached: %+v", state.Chests)
	}
	if err := s.AckGameEvents(ctx, user.id, state.Events[len(state.Events)-1].ID); err != nil {
		t.Fatal(err)
	}
	if left := user.state().Events; len(left) != 0 {
		t.Fatalf("acknowledged events stay seen: %v", eventKinds(left))
	}

	// Losing and regaining level 3 never grants its chest twice.
	user.complete(first, false)
	if level := user.state().Profile.Progress.Level; level != 2 {
		t.Fatalf("un-completing can lose a level, got %d", level)
	}
	user.complete(first, true)
	again := user.state()
	if again.Profile.Progress.Level != 3 || len(again.Chests) != 2 || len(again.Events) != 0 {
		t.Fatalf("regained level 3 without a new chest or celebration: %+v %d %v", again.Profile.Progress, len(again.Chests), eventKinds(again.Events))
	}

	drops, err := s.OpenChest(ctx, user.id, state.Chests[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	reopened, err := s.OpenChest(ctx, user.id, state.Chests[0].ID)
	if err != nil || len(reopened) != len(drops) {
		t.Fatalf("opening twice returns the same drops: %v %v", reopened, err)
	}
	after := user.state()
	for _, drop := range drops {
		if drop.ItemID != "" && !drop.Duplicate {
			found := false
			for _, item := range after.Inventory {
				found = found || item.ItemID == drop.ItemID
			}
			if !found {
				t.Fatalf("dropped item %s missing from inventory", drop.ItemID)
			}
		}
	}
}

func TestGameEquipHandleAndPetPostgres(t *testing.T) {
	s, _ := newGameTestStore(t)
	ctx := context.Background()
	user := newGameTestUser(t, s, "equip@game.test")
	other := newGameTestUser(t, s, "other@game.test")
	enabled := true
	if _, err := s.UpdateGameSettings(ctx, user.id, GameSettings{Enabled: &enabled}); err != nil {
		t.Fatal(err)
	}

	if _, err := s.EquipGameItem(ctx, user.id, gamification.NameEffectSlot, "gold"); !errors.Is(err, ErrNotOwned) {
		t.Fatalf("gold needs level 20: %v", err)
	}
	if _, err := s.EquipGameItem(ctx, user.id, "petHat", "hat-crown"); !errors.Is(err, ErrNotOwned) {
		t.Fatalf("unowned items cannot be equipped: %v", err)
	}
	if _, err := s.EquipGameItem(ctx, user.id, "petHat", "border-common-ring"); !errors.Is(err, ErrNotOwned) {
		t.Fatalf("a border does not fit the hat slot: %v", err)
	}
	equipped, err := s.EquipGameItem(ctx, user.id, gamification.NameEffectSlot, "plain")
	if err != nil || equipped[gamification.NameEffectSlot] != "plain" {
		t.Fatalf("equip plain: %v %v", equipped, err)
	}

	if handle, err := s.SetGameHandle(ctx, user.id, "@Night_Owl"); err != nil || handle != "night_owl" {
		t.Fatalf("SetGameHandle: %q %v", handle, err)
	}
	if _, err := s.SetGameHandle(ctx, other.id, "night_owl"); !errors.Is(err, ErrHandleTaken) {
		t.Fatalf("handles are unique: %v", err)
	}
	if _, err := s.SetGameHandle(ctx, other.id, "admin"); !errors.Is(err, ErrInvalidHandle) {
		t.Fatalf("reserved handles are refused: %v", err)
	}
	if ok, reason, err := s.HandleAvailable(ctx, other.id, "night_owl"); err != nil || ok || reason != "taken" {
		t.Fatalf("HandleAvailable: %v %q %v", ok, reason, err)
	}
	if ok, _, err := s.HandleAvailable(ctx, user.id, "night_owl"); err != nil || !ok {
		t.Fatalf("your own handle is available to you: %v %v", ok, err)
	}

	if name, err := s.SetPetName(ctx, user.id, "  Mochi   the  Brave "); err != nil || name != "Mochi the Brave" {
		t.Fatalf("SetPetName: %q %v", name, err)
	}
	if _, err := s.SetPetName(ctx, other.id, "Nope"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("no egg, no name: %v", err)
	}
	if _, err := s.PinAchievements(ctx, user.id, []string{"legend"}); !errors.Is(err, ErrNotOwned) {
		t.Fatalf("only unlocked achievements can be pinned: %v", err)
	}
	bad := "sometimes"
	if _, err := s.UpdateGameSettings(ctx, user.id, GameSettings{Visibility: &bad}); !errors.Is(err, ErrInvalidGameSettings) {
		t.Fatalf("invalid visibility: %v", err)
	}
}

func TestGameHabitCheckInsPostgres(t *testing.T) {
	s, _ := newGameTestStore(t)
	ctx := context.Background()
	user := newGameTestUser(t, s, "habits@game.test")
	today, yesterday, lastMonth := user.day(0), user.day(-1), user.day(-30)
	now := time.Now().UTC()
	habit := tasks.Habit{ID: uuid.NewString(), Title: "read", Interval: 1, Unit: "day", StartDate: lastMonth, DaysOfWeek: []int{}, CreatedAt: now.Add(-time.Hour)}
	push := func(dates ...string) {
		t.Helper()
		habit.CompletedDates = dates
		habit.UpdatedAt = time.Now().UTC()
		results, err := s.Push(ctx, user.id, []tasks.Mutation{{ID: uuid.NewString(), Kind: "upsert", Entity: "habit", Habit: habit}})
		if err != nil || !results[0].OK {
			t.Fatalf("habit push: %v %+v", err, results)
		}
	}
	push(lastMonth)
	if xp := user.state().Profile.XP; xp != 0 {
		t.Fatalf("old check-ins earn nothing, got %d", xp)
	}
	push(lastMonth, yesterday, today)
	// Yesterday: 10. Today, second day in a row: 11.
	if xp := user.state().Profile.XP; xp != 21 {
		t.Fatalf("check-ins for today and yesterday, got %d", xp)
	}
	if streak := user.state().Profile.Streak; streak.Current != 2 {
		t.Fatalf("habits count toward the streak: %+v", streak)
	}
	push(lastMonth, yesterday)
	if xp := user.state().Profile.XP; xp != 10 {
		t.Fatalf("unchecking takes the XP back, got %d", xp)
	}
}

func TestGameDailyCapPostgres(t *testing.T) {
	s, _ := newGameTestStore(t)
	user := newGameTestUser(t, s, "cap@game.test")
	for range 70 {
		user.complete(user.task(), true)
	}
	profile := user.state().Profile
	if profile.TodayTaskXP != gamification.DailyCapXP {
		t.Fatalf("task XP is capped per day: %d", profile.TodayTaskXP)
	}
}
