package gamification

// Stats are the counters achievements are evaluated against. The store
// computes them from the XP ledger and the profile after each award.
type Stats struct {
	TasksCompleted   int
	FocusCompleted   int
	PlanCompleted    int
	OnTimeCompleted  int
	EarlyCompletions int // before 08:00 local time
	LateCompletions  int // from 23:00 local time
	ProjectTasks     int
	HabitCheckIns    int
	KudosGiven       int
	KudosReceived    int
	BestStreak       int
	Level            int
	Promotions       int
	LeagueTier       int
	// ClearedFocus is true when the completion that triggered the evaluation
	// left the user with no open Focus task, after completing at least
	// ClearedFocusMinimum Focus tasks that day.
	ClearedFocus bool
	// Comeback is true when the triggering completion came after at least
	// seven days without any.
	Comeback bool
}

// ClearedFocusMinimum is how many Focus tasks a day "clean-slate" asks for.
const ClearedFocusMinimum = 3

// Achievement is unlocked once. Border and Title are the cosmetics it grants
// (item ids from the catalog), when it grants any.
type Achievement struct {
	ID       string `json:"id"`
	Category string `json:"category"`
	Rarity   Rarity `json:"rarity"`
	Secret   bool   `json:"secret,omitempty"`
	Border   string `json:"border,omitempty"`
	Title    string `json:"title,omitempty"`
	// Target is the counter goal, shown as progress while locked. Zero for
	// one-off conditions.
	Target int `json:"target,omitempty"`
	met    func(stats Stats) bool
	value  func(stats Stats) int
}

// Progress is how far stats are toward the achievement's target.
func (a Achievement) Progress(stats Stats) int {
	if a.value == nil {
		return 0
	}
	return min(a.value(stats), a.Target)
}

func counter(id, category string, rarity Rarity, target int, value func(Stats) int) Achievement {
	return Achievement{ID: id, Category: category, Rarity: rarity, Target: target, value: value, met: func(stats Stats) bool { return value(stats) >= target }}
}

// oneOff is a single-condition achievement. Only the "secret" category is
// hidden until unlocked; the others show what they ask for.
func oneOff(id, category string, rarity Rarity, met func(Stats) bool) Achievement {
	return Achievement{ID: id, Category: category, Rarity: rarity, Secret: category == "secret", met: met}
}

func withBorder(a Achievement, border string) Achievement { a.Border = border; return a }
func withTitle(a Achievement, title string) Achievement   { a.Title = title; return a }

var (
	statTasks    = func(s Stats) int { return s.TasksCompleted }
	statFocus    = func(s Stats) int { return s.FocusCompleted }
	statPlan     = func(s Stats) int { return s.PlanCompleted }
	statOnTime   = func(s Stats) int { return s.OnTimeCompleted }
	statStreak   = func(s Stats) int { return s.BestStreak }
	statHabits   = func(s Stats) int { return s.HabitCheckIns }
	statLevel    = func(s Stats) int { return s.Level }
	statProjects = func(s Stats) int { return s.ProjectTasks }
)

// Achievements is the full catalog, in display order. Ids are stable: they
// are stored in user_achievements and translated on the client.
var Achievements = []Achievement{
	// Getting started
	counter("first-step", "start", Common, 1, statTasks),
	counter("warming-up", "start", Common, 10, statTasks),
	counter("centurion", "start", Rare, 100, statTasks),
	withBorder(counter("veteran", "start", Epic, 500, statTasks), "border-epic-gems"),
	withTitle(withBorder(counter("legend", "start", Legendary, 2000, statTasks), "border-legendary-orbit"), "title-legend"),
	// Focus
	counter("in-the-zone", "focus", Common, 25, statFocus),
	withTitle(counter("firefighter", "focus", Epic, 250, statFocus), "title-firefighter"),
	oneOff("clean-slate", "focus", Rare, func(s Stats) bool { return s.ClearedFocus }),
	// Planning: important work before it becomes urgent
	withTitle(withBorder(counter("the-planner", "planning", Rare, 10, statPlan), "border-laurel"), "title-planner"),
	withTitle(counter("architect", "planning", Epic, 100, statPlan), "title-architect"),
	counter("punctual", "planning", Common, 25, statOnTime),
	withTitle(counter("clockwork", "planning", Epic, 200, statOnTime), "title-clockwork"),
	// Consistency
	counter("three-in-a-row", "consistency", Common, 3, statStreak),
	withBorder(counter("week-warrior", "consistency", Rare, 7, statStreak), "border-flame"),
	withTitle(counter("unbreakable", "consistency", Epic, 30, statStreak), "title-unbreakable"),
	withBorder(counter("centennial", "consistency", Legendary, 100, statStreak), "border-frost"),
	withTitle(counter("eternal-flame", "consistency", Legendary, 365, statStreak), "title-eternal-flame"),
	// Habits
	counter("habit-forming", "habits", Common, 10, statHabits),
	counter("second-nature", "habits", Rare, 100, statHabits),
	withTitle(counter("creature-of-habit", "habits", Epic, 500, statHabits), "title-creature-of-habit"),
	// Growth
	counter("level-10", "growth", Common, 10, statLevel),
	counter("level-25", "growth", Rare, 25, statLevel),
	withBorder(counter("level-50", "growth", Epic, 50, statLevel), "border-rare-double"),
	withTitle(counter("level-100", "growth", Legendary, 100, statLevel), "title-centurion"),
	// Team
	withTitle(counter("team-player", "team", Common, 10, statProjects), "title-team-player"),
	counter("cheerleader", "team", Common, 10, func(s Stats) int { return s.KudosGiven }),
	counter("crowd-favorite", "team", Rare, 25, func(s Stats) int { return s.KudosReceived }),
	// Leagues
	oneOff("rising", "leagues", Common, func(s Stats) bool { return s.Promotions > 0 }),
	withBorder(oneOff("diamond-league", "leagues", Legendary, func(s Stats) bool { return s.LeagueTier >= len(LeagueTiers)-1 }), "border-prism"),
	// Secret
	withTitle(oneOff("early-bird", "secret", Common, func(s Stats) bool { return s.EarlyCompletions > 0 }), "title-early-bird"),
	withTitle(oneOff("night-owl", "secret", Common, func(s Stats) bool { return s.LateCompletions > 0 }), "title-night-owl"),
	oneOff("welcome-back", "secret", Common, func(s Stats) bool { return s.Comeback }),
}

// NewlyUnlocked lists achievements met by stats that are not in have.
func NewlyUnlocked(stats Stats, have map[string]bool) []Achievement {
	var unlocked []Achievement
	for _, achievement := range Achievements {
		if !have[achievement.ID] && achievement.met(stats) {
			unlocked = append(unlocked, achievement)
		}
	}
	return unlocked
}

// AchievementChest is the chest an achievement grants on top of its XP:
// epic and legendary achievements come with a chest of their rarity.
func AchievementChest(a Achievement) (Rarity, bool) {
	if a.Rarity == Epic || a.Rarity == Legendary {
		return a.Rarity, true
	}
	return "", false
}
