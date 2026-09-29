package store

import (
	"context"
	"encoding/json"
	"errors"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/gh-Constant/prior/server/internal/gamification"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// OnboardingVersion is the current onboarding. Accounts with a lower version
// see the steps added since.
const OnboardingVersion = 1

// BackfillWindow is how much completed history counts on first activation.
const BackfillWindow = 90 * 24 * time.Hour

type GamePet struct {
	Species   *string    `json:"species"`
	Name      string     `json:"name"`
	Stage     string     `json:"stage"`
	HatchedAt *time.Time `json:"hatchedAt"`
}

type GameStreak struct {
	Current int    `json:"current"`
	Best    int    `json:"best"`
	Freezes int    `json:"freezes"`
	LastDay string `json:"lastDay,omitempty"`
}

type GameProfile struct {
	OnboardingVersion  int                   `json:"onboardingVersion"`
	CurrentOnboarding  int                   `json:"currentOnboarding"`
	Enabled            bool                  `json:"enabled"`
	Handle             *string               `json:"handle"`
	AnonymousKey       string                `json:"anonymousKey"`
	Visibility         string                `json:"visibility"`
	Effects            string                `json:"effects"`
	Sounds             bool                  `json:"sounds"`
	TimeZone           string                `json:"timeZone"`
	XP                 int64                 `json:"xp"`
	Progress           gamification.Progress `json:"progress"`
	Rank               string                `json:"rank"`
	TodayTaskXP        int                   `json:"todayTaskXp"`
	DailyCapXP         int                   `json:"dailyCapXp"`
	Streak             GameStreak            `json:"streak"`
	Stardust           int                   `json:"stardust"`
	LeagueTier         string                `json:"leagueTier"`
	Pet                *GamePet              `json:"pet"`
	Equipped           map[string]string     `json:"equipped"`
	PinnedAchievements []string              `json:"pinnedAchievements"`
	NameEffects        []string              `json:"nameEffects"`
}

type GameInventoryItem struct {
	ItemID     string    `json:"itemId"`
	Kind       string    `json:"kind"`
	AcquiredAt time.Time `json:"acquiredAt"`
}

type GameAchievement struct {
	ID         string              `json:"id"`
	Category   string              `json:"category"`
	Rarity     gamification.Rarity `json:"rarity"`
	Secret     bool                `json:"secret,omitempty"`
	Border     string              `json:"border,omitempty"`
	Title      string              `json:"title,omitempty"`
	Target     int                 `json:"target,omitempty"`
	Progress   int                 `json:"progress"`
	UnlockedAt *time.Time          `json:"unlockedAt"`
}

type GameChest struct {
	ID        string    `json:"id"`
	Tier      string    `json:"tier"`
	Source    string    `json:"source"`
	SourceRef string    `json:"sourceRef"`
	GrantedAt time.Time `json:"grantedAt"`
}

type GameEvent struct {
	ID        int64           `json:"id"`
	Kind      string          `json:"kind"`
	Payload   json.RawMessage `json:"payload"`
	CreatedAt time.Time       `json:"createdAt"`
}

type GameState struct {
	Profile      GameProfile         `json:"profile"`
	Inventory    []GameInventoryItem `json:"inventory"`
	Achievements []GameAchievement   `json:"achievements"`
	Chests       []GameChest         `json:"chests"`
	Events       []GameEvent         `json:"events"`
}

func (s *Store) inGameTx(ctx context.Context, userID uuid.UUID, run func(g *gameSession) error) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	session, err := beginGameSession(ctx, tx, userID, time.Now())
	if err != nil {
		return err
	}
	if err := run(session); err != nil {
		return err
	}
	if err := session.finish(); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func profileView(g *gameSession) (GameProfile, error) {
	p := g.p
	today := g.today()
	earned, err := g.dayTaskXP(today)
	if err != nil {
		return GameProfile{}, err
	}
	view := GameProfile{
		OnboardingVersion: p.OnboardingVersion, CurrentOnboarding: OnboardingVersion, Enabled: p.Enabled,
		Handle: p.Handle, AnonymousKey: p.AnonymousKey, Visibility: p.Visibility, Effects: p.Effects, Sounds: p.Sounds, TimeZone: p.TimeZone,
		XP: p.XP, Progress: gamification.ProgressFor(p.XP), Rank: gamification.RankFor(p.Level),
		TodayTaskXP: earned, DailyCapXP: gamification.DailyCapXP,
		Streak:   GameStreak{Current: p.Streak.Alive(today), Best: p.Streak.Best, Freezes: p.Streak.Freezes, LastDay: p.Streak.LastDay},
		Stardust: p.Stardust, LeagueTier: gamification.LeagueTiers[min(max(p.LeagueTier, 0), len(gamification.LeagueTiers)-1)],
		Equipped: p.Equipped, PinnedAchievements: p.Pinned,
	}
	for _, effect := range gamification.NameEffectsUnlocked(p.Level) {
		view.NameEffects = append(view.NameEffects, string(effect))
	}
	if p.PetEggAt != nil {
		view.Pet = &GamePet{Species: p.PetSpecies, Name: p.PetName, Stage: string(gamification.PetStageFor(p.Level, p.PetHatchedAt != nil)), HatchedAt: p.PetHatchedAt}
	}
	return view, nil
}

// GameState is everything the client needs to render the gamified mode,
// including celebrations it has not shown yet.
func (s *Store) GameState(ctx context.Context, userID uuid.UUID) (GameState, error) {
	var state GameState
	err := s.inGameTx(ctx, userID, func(g *gameSession) error {
		profile, err := profileView(g)
		if err != nil {
			return err
		}
		state.Profile = profile
		if state.Inventory, err = listInventory(ctx, g.tx, userID); err != nil {
			return err
		}
		if state.Achievements, err = listAchievements(g); err != nil {
			return err
		}
		if state.Chests, err = listUnopenedChests(ctx, g.tx, userID); err != nil {
			return err
		}
		state.Events, err = listUnseenEvents(ctx, g.tx, userID)
		return err
	})
	return state, err
}

func listInventory(ctx context.Context, tx pgx.Tx, userID uuid.UUID) ([]GameInventoryItem, error) {
	rows, err := tx.Query(ctx, `SELECT item_id, acquired_at FROM inventory_items WHERE user_id = $1 ORDER BY acquired_at, item_id`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []GameInventoryItem{}
	for rows.Next() {
		var item GameInventoryItem
		if err := rows.Scan(&item.ItemID, &item.AcquiredAt); err != nil {
			return nil, err
		}
		item.Kind, _ = gamification.ItemKind(item.ItemID)
		items = append(items, item)
	}
	return items, rows.Err()
}

func listAchievements(g *gameSession) ([]GameAchievement, error) {
	stats, err := g.stats()
	if err != nil {
		return nil, err
	}
	rows, err := g.tx.Query(g.ctx, `SELECT achievement_id, unlocked_at FROM user_achievements WHERE user_id = $1`, g.p.UserID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	unlocked := map[string]time.Time{}
	for rows.Next() {
		var id string
		var at time.Time
		if err := rows.Scan(&id, &at); err != nil {
			return nil, err
		}
		unlocked[id] = at
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	achievements := make([]GameAchievement, 0, len(gamification.Achievements))
	for _, a := range gamification.Achievements {
		view := GameAchievement{ID: a.ID, Category: a.Category, Rarity: a.Rarity, Secret: a.Secret, Border: a.Border, Title: a.Title, Target: a.Target, Progress: a.Progress(stats)}
		if at, ok := unlocked[a.ID]; ok {
			view.UnlockedAt = &at
			view.Progress = a.Target
		}
		achievements = append(achievements, view)
	}
	return achievements, nil
}

func listUnopenedChests(ctx context.Context, tx pgx.Tx, userID uuid.UUID) ([]GameChest, error) {
	rows, err := tx.Query(ctx, `SELECT id::text, tier, source, source_ref, granted_at FROM chests WHERE user_id = $1 AND opened_at IS NULL ORDER BY granted_at, id`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	chests := []GameChest{}
	for rows.Next() {
		var chest GameChest
		if err := rows.Scan(&chest.ID, &chest.Tier, &chest.Source, &chest.SourceRef, &chest.GrantedAt); err != nil {
			return nil, err
		}
		chests = append(chests, chest)
	}
	return chests, rows.Err()
}

func listUnseenEvents(ctx context.Context, tx pgx.Tx, userID uuid.UUID) ([]GameEvent, error) {
	rows, err := tx.Query(ctx, `SELECT id, kind, payload, created_at FROM game_events WHERE user_id = $1 AND seen_at IS NULL ORDER BY id LIMIT 50`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	events := []GameEvent{}
	for rows.Next() {
		var event GameEvent
		if err := rows.Scan(&event.ID, &event.Kind, &event.Payload, &event.CreatedAt); err != nil {
			return nil, err
		}
		events = append(events, event)
	}
	return events, rows.Err()
}

// AckGameEvents marks every celebration up to id as shown.
func (s *Store) AckGameEvents(ctx context.Context, userID uuid.UUID, upTo int64) error {
	_, err := s.pool.Exec(ctx, `UPDATE game_events SET seen_at = now() WHERE user_id = $1 AND id <= $2 AND seen_at IS NULL`, userID, upTo)
	return err
}

// GameSettings is a partial update; nil fields are left unchanged.
type GameSettings struct {
	OnboardingVersion *int    `json:"onboardingVersion"`
	Enabled           *bool   `json:"enabled"`
	Visibility        *string `json:"visibility"`
	Effects           *string `json:"effects"`
	Sounds            *bool   `json:"sounds"`
	TimeZone          *string `json:"timeZone"`
}

var ErrInvalidGameSettings = errors.New("invalid game settings")

// UpdateGameSettings applies onboarding and settings choices. The first
// switch to the gamified experience gives the egg and the starter items,
// and credits the last BackfillWindow of completed tasks once.
func (s *Store) UpdateGameSettings(ctx context.Context, userID uuid.UUID, settings GameSettings) (GameProfile, error) {
	if settings.Visibility != nil && !slices.Contains([]string{"public", "anonymous", "hidden"}, *settings.Visibility) ||
		settings.Effects != nil && !slices.Contains([]string{"full", "subtle", "off"}, *settings.Effects) ||
		settings.OnboardingVersion != nil && (*settings.OnboardingVersion < 0 || *settings.OnboardingVersion > OnboardingVersion) {
		return GameProfile{}, ErrInvalidGameSettings
	}
	if settings.TimeZone != nil {
		if _, err := time.LoadLocation(*settings.TimeZone); err != nil || *settings.TimeZone == "" || len(*settings.TimeZone) > 64 {
			return GameProfile{}, ErrInvalidGameSettings
		}
	}
	var view GameProfile
	err := s.inGameTx(ctx, userID, func(g *gameSession) error {
		if settings.OnboardingVersion != nil {
			g.p.OnboardingVersion = max(g.p.OnboardingVersion, *settings.OnboardingVersion)
		}
		if settings.Visibility != nil {
			g.p.Visibility = *settings.Visibility
		}
		if settings.Effects != nil {
			g.p.Effects = *settings.Effects
		}
		if settings.Sounds != nil {
			g.p.Sounds = *settings.Sounds
		}
		if settings.TimeZone != nil {
			g.p.TimeZone = *settings.TimeZone
			g.loc = gamification.LoadLocation(g.p.TimeZone)
		}
		if settings.Enabled != nil {
			g.p.Enabled = *settings.Enabled
			if g.p.Enabled && g.p.ActivatedAt == nil {
				if err := g.activate(); err != nil {
					return err
				}
			}
		}
		var err error
		view, err = profileView(g)
		return err
	})
	return view, err
}

func (g *gameSession) activate() error {
	now := g.now
	g.p.ActivatedAt = &now
	if g.p.PetEggAt == nil {
		g.p.PetEggAt = &now
	}
	for _, item := range gamification.StarterItems {
		if _, err := g.tx.Exec(g.ctx, `INSERT INTO inventory_items (user_id, item_id, source) VALUES ($1, $2, 'starter') ON CONFLICT DO NOTHING`, g.p.UserID, item); err != nil {
			return err
		}
	}
	if g.p.Equipped["border"] == "" {
		g.p.Equipped["border"] = "border-common-ring"
	}
	if g.p.Equipped["confetti"] == "" {
		g.p.Equipped["confetti"] = "confetti-classic"
	}
	if g.p.BackfilledAt != nil {
		return nil
	}
	g.p.BackfilledAt = &now
	return g.backfill()
}

// backfill credits the user's own completed tasks of the last BackfillWindow
// that the ledger does not know yet, applying the daily curve day by day.
// Backfilled XP counts toward level and achievements, never leagues.
func (g *gameSession) backfill() error {
	rows, err := g.tx.Query(g.ctx, `
		SELECT t.id, t.important, t.urgent, t.due_date, t.created_at, t.updated_at
		FROM tasks t
		WHERE t.user_id = $1 AND t.completed AND t.deleted_at IS NULL AND t.project_id IS NULL AND t.updated_at >= $2
		  AND NOT EXISTS (SELECT 1 FROM xp_events e WHERE e.user_id = $1 AND e.source_kind = 'task' AND e.source_id = t.id::text)
		ORDER BY t.updated_at`, g.p.UserID, g.now.Add(-BackfillWindow))
	if err != nil {
		return err
	}
	type completed struct {
		id                   uuid.UUID
		important, urgent    bool
		dueDate              *string
		createdAt, updatedAt time.Time
	}
	var history []completed
	for rows.Next() {
		var item completed
		if err := rows.Scan(&item.id, &item.important, &item.urgent, &item.dueDate, &item.createdAt, &item.updatedAt); err != nil {
			rows.Close()
			return err
		}
		history = append(history, item)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	earnedByDay := map[string]int{}
	total := 0
	for _, item := range history {
		local := item.updatedAt.In(g.loc)
		day := local.Format(time.DateOnly)
		completion := gamification.TaskCompletion{Important: item.important, Urgent: item.urgent, DueDate: item.dueDate, CreatedAt: item.createdAt, CompletedAt: item.updatedAt, Location: g.loc}
		amount := gamification.ApplyDailyCurve(earnedByDay[day], gamification.TaskXP(completion))
		earnedByDay[day] += amount
		var quadrant *string
		if item.updatedAt.Sub(item.createdAt) >= gamification.MinTaskAge {
			value := string(gamification.QuadrantOf(item.important, item.urgent))
			quadrant = &value
		}
		onTime := quadrant != nil && item.dueDate != nil && gamification.CompletedOnTime(*item.dueDate, item.updatedAt, g.loc)
		if _, err := g.tx.Exec(g.ctx, `
			INSERT INTO xp_events (user_id, source_kind, source_id, amount, day, quadrant, on_time, backfill, occurred_at)
			VALUES ($1, 'task', $2, $3, $4::date, $5, $6, TRUE, $7) ON CONFLICT DO NOTHING`,
			g.p.UserID, item.id.String(), amount, day, quadrant, onTime, item.updatedAt); err != nil {
			return err
		}
		total += amount
	}
	before := g.p.Level
	g.quiet = true
	defer func() { g.quiet = false }()
	if err := g.addXP(int64(total)); err != nil {
		return err
	}
	if err := g.evaluateAchievements(); err != nil {
		return err
	}
	if len(history) > 0 {
		g.emit("backfill", map[string]any{"tasks": len(history), "xp": total, "fromLevel": before, "level": g.p.Level})
	}
	return nil
}

// SetGameHandle claims a public handle.
func (s *Store) SetGameHandle(ctx context.Context, userID uuid.UUID, raw string) (string, error) {
	handle := gamification.NormalizeHandle(raw)
	if problem := gamification.HandleProblem(handle); problem != "" {
		return "", errors.Join(ErrInvalidHandle, errors.New(problem))
	}
	err := s.inGameTx(ctx, userID, func(g *gameSession) error {
		g.p.Handle = &handle
		return nil
	})
	if isUniqueViolation(err) {
		return "", ErrHandleTaken
	}
	return handle, err
}

// HandleAvailable reports whether a handle can be claimed by userID.
func (s *Store) HandleAvailable(ctx context.Context, userID uuid.UUID, raw string) (bool, string, error) {
	handle := gamification.NormalizeHandle(raw)
	if problem := gamification.HandleProblem(handle); problem != "" {
		return false, problem, nil
	}
	var taken bool
	err := s.pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM game_profiles WHERE handle = $1 AND user_id <> $2)`, handle, userID).Scan(&taken)
	if taken {
		return false, "taken", err
	}
	return true, "", err
}

// EquipGameItem puts an owned item, or an unlocked name effect, in a slot.
// An empty item empties the slot.
func (s *Store) EquipGameItem(ctx context.Context, userID uuid.UUID, slot, itemID string) (map[string]string, error) {
	var equipped map[string]string
	err := s.inGameTx(ctx, userID, func(g *gameSession) error {
		if itemID == "" {
			delete(g.p.Equipped, slot)
			equipped = g.p.Equipped
			return nil
		}
		if slot == gamification.NameEffectSlot {
			if !slices.Contains(gamification.NameEffectsUnlocked(g.p.Level), gamification.NameEffect(itemID)) {
				return ErrNotOwned
			}
		} else {
			kind, ok := gamification.EquipSlots[slot]
			if !ok {
				return ErrInvalidGameSettings
			}
			owned, err := g.ownedItems()
			if err != nil {
				return err
			}
			if itemKind, _ := gamification.ItemKind(itemID); !owned[itemID] || itemKind != kind {
				return ErrNotOwned
			}
		}
		g.p.Equipped[slot] = itemID
		equipped = g.p.Equipped
		return nil
	})
	return equipped, err
}

// PinAchievements chooses up to three unlocked achievements for the profile card.
func (s *Store) PinAchievements(ctx context.Context, userID uuid.UUID, ids []string) ([]string, error) {
	if len(ids) > 3 {
		return nil, ErrInvalidGameSettings
	}
	var pinned []string
	err := s.inGameTx(ctx, userID, func(g *gameSession) error {
		have, err := g.unlockedAchievements()
		if err != nil {
			return err
		}
		pinned = []string{}
		for _, id := range ids {
			if !have[id] {
				return ErrNotOwned
			}
			if !slices.Contains(pinned, id) {
				pinned = append(pinned, id)
			}
		}
		g.p.Pinned = pinned
		return nil
	})
	return pinned, err
}

// SetPetName names the pet once it exists.
func (s *Store) SetPetName(ctx context.Context, userID uuid.UUID, name string) (string, error) {
	name = strings.Join(strings.Fields(name), " ")
	if utf8.RuneCountInString(name) > 24 {
		return "", ErrInvalidGameSettings
	}
	err := s.inGameTx(ctx, userID, func(g *gameSession) error {
		if g.p.PetEggAt == nil {
			return ErrNotFound
		}
		g.p.PetName = name
		return nil
	})
	return name, err
}

// OpenedDrop is a chest drop as it was applied: an item already owned by the
// time the chest is opened turns into stardust.
type OpenedDrop struct {
	gamification.Drop
	Kind string `json:"kind,omitempty"`
}

// OpenChest applies a chest's contents. Opening twice returns the same drops.
func (s *Store) OpenChest(ctx context.Context, userID uuid.UUID, chestID string) ([]OpenedDrop, error) {
	id, err := uuid.Parse(chestID)
	if err != nil {
		return nil, ErrNotFound
	}
	var opened []OpenedDrop
	err = s.inGameTx(ctx, userID, func(g *gameSession) error {
		var contents []byte
		var openedAt *time.Time
		err := g.tx.QueryRow(ctx, `SELECT contents, opened_at FROM chests WHERE id = $1 AND user_id = $2 FOR UPDATE`, id, userID).Scan(&contents, &openedAt)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		var drops []OpenedDrop
		if err := json.Unmarshal(contents, &drops); err != nil {
			return err
		}
		if openedAt != nil {
			opened = drops
			return nil
		}
		owned, err := g.ownedItems()
		if err != nil {
			return err
		}
		for index := range drops {
			drop := &drops[index]
			switch {
			case drop.Freeze && g.p.Streak.Freezes < gamification.MaxFreezes:
				g.p.Streak.Freezes++
			case drop.Freeze:
				drop.Freeze, drop.Stardust = false, gamification.DuplicateStardust[gamification.Rare]
			case drop.ItemID != "" && (drop.Duplicate || owned[drop.ItemID]):
				drop.Duplicate, drop.Stardust = true, gamification.DuplicateStardust[drop.Rarity]
			case drop.ItemID != "":
				if _, err := g.tx.Exec(ctx, `INSERT INTO inventory_items (user_id, item_id, source) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, userID, drop.ItemID, "chest:"+chestID); err != nil {
					return err
				}
				owned[drop.ItemID] = true
			}
			g.p.Stardust += drop.Stardust
			drop.Kind, _ = gamification.ItemKind(drop.ItemID)
		}
		resolved, err := json.Marshal(drops)
		if err != nil {
			return err
		}
		if _, err := g.tx.Exec(ctx, `UPDATE chests SET opened_at = now(), contents = $2 WHERE id = $1`, id, resolved); err != nil {
			return err
		}
		opened = drops
		return nil
	})
	return opened, err
}

// CraftItem turns stardust into a specific catalog item.
func (s *Store) CraftItem(ctx context.Context, userID uuid.UUID, itemID string) (int, error) {
	index := slices.IndexFunc(gamification.Catalog, func(item gamification.Item) bool { return item.ID == itemID })
	if index < 0 {
		return 0, ErrNotFound
	}
	item := gamification.Catalog[index]
	var stardust int
	err := s.inGameTx(ctx, userID, func(g *gameSession) error {
		owned, err := g.ownedItems()
		if err != nil {
			return err
		}
		if owned[itemID] {
			return ErrInvalidGameSettings
		}
		cost := gamification.CraftCost(item.Rarity)
		if g.p.Stardust < cost {
			return ErrNotEnough
		}
		g.p.Stardust -= cost
		if _, err := g.tx.Exec(ctx, `INSERT INTO inventory_items (user_id, item_id, source) VALUES ($1, $2, 'craft')`, userID, itemID); err != nil {
			return err
		}
		stardust = g.p.Stardust
		return nil
	})
	return stardust, err
}
