package gamification

import (
	"math/rand/v2"
	"slices"
	"testing"
	"time"
)

func TestTaskXPRewardsImportanceMost(t *testing.T) {
	created := time.Date(2026, 9, 29, 9, 0, 0, 0, time.UTC)
	done := created.Add(2 * time.Hour)
	xp := func(important, urgent bool) int {
		return TaskXP(TaskCompletion{Important: important, Urgent: urgent, CreatedAt: created, CompletedAt: done})
	}
	if xp(true, true) != 30 || xp(true, false) != 25 || xp(false, true) != 10 || xp(false, false) != 5 {
		t.Fatalf("quadrant XP = %d/%d/%d/%d", xp(true, true), xp(true, false), xp(false, true), xp(false, false))
	}
	if xp(true, false) <= xp(false, true) {
		t.Fatal("important work must beat urgent busywork")
	}
}

func TestTaskXPOnTimeBonusUsesTheUserCalendar(t *testing.T) {
	paris, err := time.LoadLocation("Europe/Paris")
	if err != nil {
		t.Skip("no tzdata")
	}
	due := "2026-09-29"
	created := time.Date(2026, 9, 20, 9, 0, 0, 0, time.UTC)
	cases := []struct {
		name string
		at   time.Time
		want int
	}{
		{"same evening in Paris", time.Date(2026, 9, 29, 23, 30, 0, 0, paris), 36},
		{"after midnight in Paris, still the 29th in UTC", time.Date(2026, 9, 30, 0, 30, 0, 0, paris), 30},
		{"early", time.Date(2026, 9, 25, 12, 0, 0, 0, paris), 36},
	}
	for _, tc := range cases {
		got := TaskXP(TaskCompletion{Important: true, Urgent: true, DueDate: &due, CreatedAt: created, CompletedAt: tc.at, Location: paris})
		if got != tc.want {
			t.Fatalf("%s: got %d, want %d", tc.name, got, tc.want)
		}
	}
	bad := "soon"
	if got := TaskXP(TaskCompletion{Important: true, Urgent: true, DueDate: &bad, CreatedAt: created, CompletedAt: created.Add(time.Hour)}); got != 30 {
		t.Fatalf("an unparsable due date must not earn a bonus, got %d", got)
	}
}

func TestTaskXPIgnoresFarmedTasks(t *testing.T) {
	created := time.Date(2026, 9, 29, 9, 0, 0, 0, time.UTC)
	got := TaskXP(TaskCompletion{Important: true, Urgent: true, CreatedAt: created, CompletedAt: created.Add(20 * time.Second)})
	if got != FarmedTaskXP {
		t.Fatalf("instant completion earned %d", got)
	}
}

func TestDailyCurve(t *testing.T) {
	cases := []struct{ earned, raw, want int }{
		{0, 30, 30},
		{290, 30, 20}, // 10 at full, 20 raw at half
		{590, 30, 12}, // 20 raw at half, 10 raw at a fifth
		{600, 10, 2},
		{700, 1, 1},  // every completion earns something below the cap
		{799, 30, 1}, // never past the cap
		{800, 30, 0},
		{0, 0, 0},
	}
	for _, tc := range cases {
		if got := ApplyDailyCurve(tc.earned, tc.raw); got != tc.want {
			t.Fatalf("ApplyDailyCurve(%d, %d) = %d, want %d", tc.earned, tc.raw, got, tc.want)
		}
	}
	earned := 0
	for range 40 {
		earned += ApplyDailyCurve(earned, 30)
	}
	if earned < 650 || earned > 660 {
		t.Fatalf("40 focus tasks in a day earned %d, want about 660", earned)
	}
	for range 1000 {
		earned += ApplyDailyCurve(earned, 30)
	}
	if earned != DailyCapXP {
		t.Fatalf("a day is capped at %d, got %d", DailyCapXP, earned)
	}
}

func TestSmallRewards(t *testing.T) {
	if HabitCheckInXP(0) != 10 || HabitCheckInXP(4) != 14 || HabitCheckInXP(40) != 20 {
		t.Fatal("habit bonus grows with the streak and is capped")
	}
	if KudosAward(0) != KudosXP || KudosAward(MaxKudosPerDay) != 0 {
		t.Fatal("kudos are capped per day")
	}
}

func TestLevelCurveIsExactAndMonotonic(t *testing.T) {
	if XPToReach(1) != 0 || XPToReach(2) != OnboardingXP {
		t.Fatalf("level 2 must take exactly the onboarding bonus, got %d", XPToReach(2))
	}
	for level := 2; level <= 400; level++ {
		if XPToReach(level) <= XPToReach(level-1) {
			t.Fatalf("curve not increasing at %d", level)
		}
		at := ProgressFor(XPToReach(level))
		below := ProgressFor(XPToReach(level) - 1)
		if at.Level != level || at.XPInLevel != 0 || below.Level != level-1 {
			t.Fatalf("boundary of level %d: at=%+v below=%+v", level, at, below)
		}
		if below.XPInLevel+XPToReach(level-1) != XPToReach(level)-1 || below.XPForLevel != XPToReach(level)-XPToReach(level-1) {
			t.Fatalf("progress inside level %d is inconsistent: %+v", level-1, below)
		}
	}
	if ProgressFor(-5).Level != 1 {
		t.Fatal("negative XP stays at level 1")
	}
}

func TestLevelCurveCalibration(t *testing.T) {
	const activeXPPerDay = 150
	cases := []struct{ level, minDays, maxDays int }{
		{10, 10, 18},
		{20, 40, 65},
		{50, 250, 365},
		{100, 700, 2000},
	}
	for _, tc := range cases {
		days := int(XPToReach(tc.level) / activeXPPerDay)
		if days < tc.minDays || days > tc.maxDays {
			t.Fatalf("level %d takes %d active days, want %d–%d", tc.level, days, tc.minDays, tc.maxDays)
		}
	}
}

func TestRanksNameEffectsAndPetStages(t *testing.T) {
	for level, want := range map[int]string{0: "spark", 1: "spark", 9: "spark", 10: "ember", 35: "blaze", 42: "nova", 99: "infinity", 250: "infinity"} {
		if got := RankFor(level); got != want {
			t.Fatalf("RankFor(%d) = %s, want %s", level, got, want)
		}
	}
	if got := NameEffectsUnlocked(1); !slices.Equal(got, []NameEffect{"plain"}) {
		t.Fatalf("level 1 effects = %v", got)
	}
	if got := NameEffectsUnlocked(20); got[len(got)-1] != "gold" {
		t.Fatalf("level 20 unlocks gold, got %v", got)
	}
	if len(NameEffectsUnlocked(100)) != 9 {
		t.Fatal("level 100 unlocks every effect")
	}
	stages := map[int]PetStage{1: StageBaby, 9: StageBaby, 10: StageYoung, 25: StageAdult, 50: StageRadiant}
	for level, want := range stages {
		if got := PetStageFor(level, true); got != want {
			t.Fatalf("PetStageFor(%d) = %s, want %s", level, got, want)
		}
	}
	if PetStageFor(80, false) != StageEgg {
		t.Fatal("an unhatched pet stays an egg")
	}
}

func day(offset int) string {
	return time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC).AddDate(0, 0, offset).Format(time.DateOnly)
}

func TestStreakGrowsAndResets(t *testing.T) {
	var s Streak
	s, update := s.Record(day(0))
	if s.Current != 1 || !update.Extended {
		t.Fatalf("first day: %+v", s)
	}
	if again, update := s.Record(day(0)); again != s || update.Extended {
		t.Fatal("the same day twice changes nothing")
	}
	if earlier, _ := s.Record(day(-3)); earlier != s {
		t.Fatal("an earlier day changes nothing")
	}
	s, _ = s.Record(day(1))
	if s.Current != 2 {
		t.Fatalf("next day: %+v", s)
	}
	s, update = s.Record(day(3))
	if s.Current != 1 || !update.Reset || s.Best != 2 {
		t.Fatalf("a missed day without freeze resets: %+v %+v", s, update)
	}
}

func TestStreakFreezesAndMilestones(t *testing.T) {
	var s Streak
	var update StreakUpdate
	for offset := range 7 {
		s, update = s.Record(day(offset))
	}
	if s.Current != 7 || s.Freezes != 1 || update.FreezesEarned != 1 || update.Milestone != Rare {
		t.Fatalf("day 7: %+v %+v", s, update)
	}
	s, update = s.Record(day(8)) // day 7 missed, covered by the freeze
	if s.Current != 8 || s.Freezes != 0 || update.FreezesUsed != 1 || update.Reset {
		t.Fatalf("freeze bridge: %+v %+v", s, update)
	}
	for offset := 9; offset < 60; offset++ {
		s, _ = s.Record(day(offset))
	}
	if s.Freezes != MaxFreezes {
		t.Fatalf("freezes are capped at %d, got %d", MaxFreezes, s.Freezes)
	}
}

func TestStreakAlive(t *testing.T) {
	s := Streak{Current: 12, Best: 12, LastDay: day(10)}
	if s.Alive(day(10)) != 12 || s.Alive(day(11)) != 12 {
		t.Fatal("a streak is alive today and the day after")
	}
	if s.Alive(day(12)) != 0 {
		t.Fatal("one missed day without freeze ends it")
	}
	s.Freezes = 1
	if s.Alive(day(12)) != 12 || s.Alive(day(13)) != 0 {
		t.Fatal("a freeze covers exactly one missed day")
	}
	if (Streak{}).Alive(day(0)) != 0 {
		t.Fatal("no streak yet")
	}
}

func testCatalog() []Item {
	var catalog []Item
	for _, rarity := range rarityOrder {
		for index := range 4 {
			catalog = append(catalog, Item{ID: string(rarity) + "-" + string(rune('a'+index)), Kind: "pet-hat", Rarity: rarity})
		}
	}
	return catalog
}

func TestChestTiers(t *testing.T) {
	for level, want := range map[int]Rarity{2: Common, 5: Rare, 10: Rare, 25: Epic, 50: Epic, 51: Common} {
		if got := ChestForLevel(level); got != want {
			t.Fatalf("ChestForLevel(%d) = %s, want %s", level, got, want)
		}
	}
	rng := rand.New(rand.NewPCG(1, 2))
	for range 200 {
		drops := RollChest(Legendary, testCatalog(), nil, rng)
		items := slices.DeleteFunc(slices.Clone(drops), func(drop Drop) bool { return drop.Freeze })
		if len(items) != 3 || items[2].Rarity != Legendary {
			t.Fatalf("a legendary chest guarantees a legendary last item: %+v", drops)
		}
	}
}

func TestChestPrefersNewItemsThenStardust(t *testing.T) {
	rng := rand.New(rand.NewPCG(3, 4))
	catalog := testCatalog()
	for range 200 {
		drops := RollChest(Epic, catalog, map[string]bool{"common-a": true}, rng)
		seen := map[string]bool{}
		for _, drop := range drops {
			if drop.Freeze {
				continue
			}
			if drop.Duplicate || drop.ItemID == "common-a" || seen[drop.ItemID] {
				t.Fatalf("fresh items were available: %+v", drops)
			}
			seen[drop.ItemID] = true
		}
	}
	owned := map[string]bool{}
	for _, item := range catalog {
		owned[item.ID] = true
	}
	for _, drop := range RollChest(Rare, catalog, owned, rng) {
		if !drop.Freeze && (!drop.Duplicate || drop.Stardust != DuplicateStardust[drop.Rarity]) {
			t.Fatalf("a complete collection turns drops into stardust: %+v", drop)
		}
	}
	if CraftCost(Legendary) != 800 {
		t.Fatal("crafting costs four duplicates")
	}
}

func TestChestNeverInflatesASparseCatalog(t *testing.T) {
	rng := rand.New(rand.NewPCG(5, 6))
	commons := []Item{{ID: "only", Kind: "confetti", Rarity: Common}}
	for range 100 {
		for _, drop := range RollChest(Legendary, commons, nil, rng) {
			if !drop.Freeze && drop.Rarity != Common {
				t.Fatalf("no rare items exist, got %+v", drop)
			}
		}
	}
	for _, drop := range RollChest(Rare, nil, nil, rng) {
		if !drop.Freeze {
			t.Fatalf("an empty catalog drops no item, got %+v", drop)
		}
	}
}

func TestChestOddsMatchTheTable(t *testing.T) {
	rng := rand.New(rand.NewPCG(7, 8))
	counts := map[Rarity]int{}
	const rolls = 20000
	for range rolls {
		for _, drop := range RollChest(Common, testCatalog(), nil, rng) {
			if !drop.Freeze {
				counts[drop.Rarity]++
			}
		}
	}
	if share := float64(counts[Common]) / rolls; share < 0.78 || share > 0.82 {
		t.Fatalf("common share %.3f, want about 0.80", share)
	}
	if counts[Legendary] != 0 {
		t.Fatal("common chests never drop legendaries")
	}
}

func TestPetSpeciesOdds(t *testing.T) {
	rng := rand.New(rand.NewPCG(9, 10))
	counts := map[string]int{}
	const rolls = 50000
	for range rolls {
		counts[RollPetSpecies(rng)]++
	}
	if share := float64(counts["ember"]) / rolls; share < 0.09 || share > 0.11 {
		t.Fatalf("ember share %.3f, want about 0.10", share)
	}
	if len(counts) != 4 {
		t.Fatalf("species rolled: %v", counts)
	}
}

func TestWeekStart(t *testing.T) {
	sunday := time.Date(2026, 10, 4, 23, 59, 0, 0, time.UTC)
	monday := time.Date(2026, 9, 28, 0, 0, 0, 0, time.UTC)
	if got := WeekStart(sunday); !got.Equal(monday) {
		t.Fatalf("WeekStart(sunday) = %s", got)
	}
	if got := WeekStart(monday); !got.Equal(monday) {
		t.Fatalf("WeekStart(monday) = %s", got)
	}
}

func TestLeagueZones(t *testing.T) {
	cases := []struct{ size, promote, demote int }{
		{0, 0, 0}, {1, 1, 0}, {2, 1, 0}, {3, 1, 1}, {10, 2, 2}, {30, 7, 5}, {40, 7, 5},
	}
	for _, tc := range cases {
		promote, demote := Zones(tc.size)
		if promote != tc.promote || demote != tc.demote {
			t.Fatalf("Zones(%d) = %d/%d, want %d/%d", tc.size, promote, demote, tc.promote, tc.demote)
		}
	}
}

func TestCloseCohort(t *testing.T) {
	start := time.Date(2026, 9, 28, 0, 0, 0, 0, time.UTC)
	var entries []LeagueEntry
	for index := range 30 {
		entries = append(entries, LeagueEntry{UserID: string(rune('A' + index)), WeeklyXP: int64(1000 - index*10), JoinedAt: start.Add(time.Duration(index) * time.Minute)})
	}
	// A tie: the earlier joiner ranks higher.
	entries[1].WeeklyXP = entries[0].WeeklyXP
	results := CloseCohort(3, entries)
	if results[0].UserID != "A" || results[1].UserID != "B" {
		t.Fatalf("tie break: %+v %+v", results[0], results[1])
	}
	outcomes := map[Outcome]int{}
	for _, result := range results {
		outcomes[result.Outcome]++
	}
	if outcomes[Promoted] != 7 || outcomes[Demoted] != 5 || results[0].Tier != 4 || results[29].Tier != 2 {
		t.Fatalf("outcomes %v, first %+v, last %+v", outcomes, results[0], results[29])
	}
	top := CloseCohort(len(LeagueTiers)-1, entries)
	bottom := CloseCohort(0, entries)
	if top[0].Outcome != Stayed || bottom[29].Outcome != Stayed {
		t.Fatal("the top tier cannot promote and the bottom tier cannot demote")
	}
	idle := CloseCohort(2, []LeagueEntry{{UserID: "Z", WeeklyXP: 0}})
	if idle[0].Outcome != Stayed {
		t.Fatal("nobody is promoted without XP")
	}
}

func TestHandles(t *testing.T) {
	if got := NormalizeHandle("  @Night_Owl "); got != "night_owl" {
		t.Fatalf("NormalizeHandle = %q", got)
	}
	cases := map[string]string{
		"night_owl": "", "computer_nerd": "", "brochure": "", "grapefruit": "", "dickens": "", "this_hit": "", "helpful": "", "teamwork": "",
		"ab": "format", "Night": "format", "way_too_long_handle_123": "format", "émile": "format",
		"prior_team": "reserved", "admin42": "reserved", "team": "reserved",
		"sh1t_happens": "blocked", "big_dick": "blocked", "puta2": "blocked", "fuckyou": "blocked",
	}
	for handle, want := range cases {
		if got := HandleProblem(handle); got != want {
			t.Fatalf("HandleProblem(%q) = %q, want %q", handle, got, want)
		}
	}
}

func TestHabitHelpers(t *testing.T) {
	if !HabitCheckInEligible(day(5), day(5)) || !HabitCheckInEligible(day(4), day(5)) {
		t.Fatal("today and yesterday earn XP")
	}
	if HabitCheckInEligible(day(3), day(5)) || HabitCheckInEligible(day(6), day(5)) || HabitCheckInEligible("x", day(5)) {
		t.Fatal("older, future or invalid dates earn nothing")
	}
	dates := []string{day(1), day(3), day(4), day(5), day(5)}
	if ConsecutiveDays(dates, day(5)) != 3 || ConsecutiveDays(dates, day(2)) != 0 || ConsecutiveDays(dates, day(1)) != 1 {
		t.Fatal("consecutive run ending on a day")
	}
}

func TestAchievementCatalog(t *testing.T) {
	ids := map[string]bool{}
	for _, achievement := range Achievements {
		if ids[achievement.ID] {
			t.Fatalf("duplicate achievement %s", achievement.ID)
		}
		ids[achievement.ID] = true
		if _, ok := AchievementXP[achievement.Rarity]; !ok {
			t.Fatalf("%s has no XP for rarity %q", achievement.ID, achievement.Rarity)
		}
		for _, reward := range []string{achievement.Border, achievement.Title} {
			if reward != "" {
				if _, ok := ItemKind(reward); !ok {
					t.Fatalf("%s grants unknown item %s", achievement.ID, reward)
				}
			}
		}
	}
	for _, achievement := range Achievements {
		if achievement.Secret != (achievement.Category == "secret") {
			t.Fatalf("%s: only the secret category is hidden", achievement.ID)
		}
	}
	if len(Achievements) < 30 {
		t.Fatalf("expected about thirty achievements, got %d", len(Achievements))
	}
	got := NewlyUnlocked(Stats{TasksCompleted: 12, PlanCompleted: 10, BestStreak: 7, EarlyCompletions: 1}, map[string]bool{"first-step": true})
	var names []string
	for _, achievement := range got {
		names = append(names, achievement.ID)
	}
	want := []string{"warming-up", "the-planner", "three-in-a-row", "week-warrior", "early-bird"}
	if !slices.Equal(names, want) {
		t.Fatalf("NewlyUnlocked = %v, want %v", names, want)
	}
	planner := Achievements[slices.IndexFunc(Achievements, func(a Achievement) bool { return a.ID == "the-planner" })]
	if planner.Progress(Stats{PlanCompleted: 4}) != 4 || planner.Progress(Stats{PlanCompleted: 40}) != 10 {
		t.Fatal("progress is capped at the target")
	}
	if tier, ok := AchievementChest(planner); ok || tier != "" {
		t.Fatal("rare achievements give no chest")
	}
}

func TestItemCatalog(t *testing.T) {
	ids := map[string]bool{}
	for _, item := range Catalog {
		if ids[item.ID] {
			t.Fatalf("duplicate item %s", item.ID)
		}
		ids[item.ID] = true
		if kind, ok := ItemKind(item.ID); !ok || kind != item.Kind {
			t.Fatalf("ItemKind(%s) = %s", item.ID, kind)
		}
		if !slices.Contains(slices.Collect(func(yield func(string) bool) {
			for _, kind := range EquipSlots {
				if !yield(kind) {
					return
				}
			}
		}), item.Kind) {
			t.Fatalf("%s has a kind no slot accepts", item.ID)
		}
	}
	for _, starter := range StarterItems {
		if _, ok := ItemKind(starter); !ok {
			t.Fatalf("unknown starter item %s", starter)
		}
	}
	if _, ok := ItemKind("nope"); ok {
		t.Fatal("unknown items are refused")
	}
}
