// Package gamification holds the pure rules of Prior's gamified mode: how
// much experience an action is worth, the level curve, streaks, chests and
// weekly leagues. Nothing here touches the database, so every rule is unit
// tested on its own. See specs/GAMIFICATION.md.
package gamification

import (
	"math"
	"time"
)

// Quadrant is the Eisenhower quadrant of a task.
type Quadrant string

const (
	Focus Quadrant = "focus" // important + urgent
	Plan  Quadrant = "plan"  // important, not urgent
	Quick Quadrant = "quick" // urgent, not important
	Later Quadrant = "later"
)

func QuadrantOf(important, urgent bool) Quadrant {
	switch {
	case important && urgent:
		return Focus
	case important:
		return Plan
	case urgent:
		return Quick
	default:
		return Later
	}
}

// Plan earns almost as much as Focus on purpose: important work that is not
// yet urgent is what people neglect, and the game should pull toward it.
var quadrantXP = map[Quadrant]int{Focus: 30, Plan: 25, Quick: 10, Later: 5}

const (
	// A task completed this soon after its creation is almost certainly
	// being farmed, so it only earns FarmedTaskXP.
	MinTaskAge   = time.Minute
	FarmedTaskXP = 1
	// Daily diminishing returns on task XP: full value up to the first
	// threshold, half up to the second, a fifth beyond, and nothing past the
	// hard cap. The cap bounds what a scripted client can earn in a league:
	// reaching it takes about sixty Focus tasks in one day.
	DailyFullXP = 300
	DailyHalfXP = 600
	DailyCapXP  = 800
	// Welcome bonus granted once, on the first completion after onboarding,
	// so the very first task always reaches level 2.
	OnboardingXP = 30
	// Kudos received from teammates.
	KudosXP         = 5
	MaxKudosPerDay  = 5
	HabitXP         = 10
	MaxHabitBonusXP = 10
)

// TaskCompletion describes a task at the moment it becomes completed.
type TaskCompletion struct {
	Important   bool
	Urgent      bool
	DueDate     *string // "YYYY-MM-DD", in the user's calendar
	CreatedAt   time.Time
	CompletedAt time.Time
	Location    *time.Location // the user's time zone; UTC when nil
}

// TaskXP is the raw XP of one completion, before the daily curve.
func TaskXP(c TaskCompletion) int {
	if c.CompletedAt.Sub(c.CreatedAt) < MinTaskAge {
		return FarmedTaskXP
	}
	xp := quadrantXP[QuadrantOf(c.Important, c.Urgent)]
	if c.DueDate != nil && CompletedOnTime(*c.DueDate, c.CompletedAt, c.Location) {
		xp += int(math.Round(float64(xp) * 0.2))
	}
	return xp
}

// CompletedOnTime reports whether a completion happened on or before its due
// date, in the user's calendar.
func CompletedOnTime(dueDate string, completedAt time.Time, location *time.Location) bool {
	if location == nil {
		location = time.UTC
	}
	due, err := time.ParseInLocation(time.DateOnly, dueDate, location)
	if err != nil {
		return false
	}
	return completedAt.In(location).Format(time.DateOnly) <= due.Format(time.DateOnly)
}

// ApplyDailyCurve returns what raw task XP is actually worth once the user
// has already earned earnedToday task XP (after the curve) today. Every
// completion earns at least 1 XP until the daily cap is reached.
func ApplyDailyCurve(earnedToday, raw int) int {
	if raw <= 0 || earnedToday >= DailyCapXP {
		return 0
	}
	awarded := 0.0
	position := float64(earnedToday)
	remaining := float64(raw)
	for remaining > 0 {
		rate, room := 0.2, math.Inf(1)
		switch {
		case position < DailyFullXP:
			rate, room = 1, DailyFullXP-position
		case position < DailyHalfXP:
			rate, room = 0.5, (DailyHalfXP-position)/0.5
		}
		spent := math.Min(remaining, room)
		awarded += spent * rate
		position += spent * rate
		remaining -= spent
	}
	return min(max(1, int(math.Floor(awarded+1e-9))), DailyCapXP-earnedToday)
}

// HabitCheckInXP rewards a habit check-in, growing with the habit's streak.
func HabitCheckInXP(streakDays int) int {
	return HabitXP + min(max(streakDays, 0), MaxHabitBonusXP)
}

// KudosAward is the XP a user gets for one more kudos after having
// received receivedToday kudos today.
func KudosAward(receivedToday int) int {
	if receivedToday >= MaxKudosPerDay {
		return 0
	}
	return KudosXP
}
