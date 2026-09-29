package gamification

import (
	"math"
	"time"
)

const (
	// A freeze is earned every FreezeEvery consecutive days, up to MaxFreezes held.
	FreezeEvery = 7
	MaxFreezes  = 2
)

// StreakMilestones grant a chest of the given tier when reached.
var StreakMilestones = map[int]Rarity{7: Rare, 30: Epic, 100: Legendary, 365: Legendary}

// Streak counts consecutive days with at least one qualifying completion,
// in the user's own calendar. Days are "YYYY-MM-DD".
type Streak struct {
	Current int    `json:"current"`
	Best    int    `json:"best"`
	LastDay string `json:"lastDay,omitempty"`
	Freezes int    `json:"freezes"`
}

// StreakUpdate reports what one recorded day changed.
type StreakUpdate struct {
	Extended      bool   // the streak grew today
	FreezesUsed   int    // freezes consumed to bridge missed days
	FreezesEarned int    // freezes earned today
	Reset         bool   // the previous streak was lost
	Milestone     Rarity // non-empty when a milestone chest is due
}

// Record registers a qualifying completion on day. Recording the same day
// twice, or a day earlier than the last one, changes nothing.
func (s Streak) Record(day string) (Streak, StreakUpdate) {
	var update StreakUpdate
	today, err := time.Parse(time.DateOnly, day)
	if err != nil {
		return s, update
	}
	if s.LastDay != "" {
		last, err := time.Parse(time.DateOnly, s.LastDay)
		if err == nil && !today.After(last) {
			return s, update
		}
		if err == nil {
			missed := daysBetween(last, today) - 1
			switch {
			case missed == 0:
			case missed <= s.Freezes:
				s.Freezes -= missed
				update.FreezesUsed = missed
			default:
				s.Current = 0
				update.Reset = true
			}
		}
	}
	s.Current++
	s.LastDay = day
	s.Best = max(s.Best, s.Current)
	update.Extended = true
	if s.Current%FreezeEvery == 0 && s.Freezes < MaxFreezes {
		s.Freezes++
		update.FreezesEarned = 1
	}
	update.Milestone = StreakMilestones[s.Current]
	return s, update
}

// Alive is the streak as it should be displayed on today: it survives while
// the missed days since the last completion can still be covered by freezes.
func (s Streak) Alive(today string) int {
	if s.LastDay == "" {
		return 0
	}
	last, err1 := time.Parse(time.DateOnly, s.LastDay)
	now, err2 := time.Parse(time.DateOnly, today)
	if err1 != nil || err2 != nil {
		return 0
	}
	// Today itself is not missed yet: the user still has until midnight.
	if missed := daysBetween(last, now) - 1; missed > s.Freezes {
		return 0
	}
	return s.Current
}

// daysBetween counts calendar days from one date to another; negative when
// to is earlier. Dates are parsed in UTC, so DST never shifts the count.
func daysBetween(from, to time.Time) int {
	return int(math.Round(to.Sub(from).Hours() / 24))
}
