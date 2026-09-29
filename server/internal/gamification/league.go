package gamification

import (
	"math"
	"sort"
	"time"
)

// Leagues are weekly: players are grouped in cohorts of about CohortSize at
// the same tier, ranked by the XP they earn that week, and the best move up
// while the last move down. Backfilled XP never counts toward a league.
const (
	CohortSize = 30
	PromoteTop = 7
	DemoteLast = 5
)

var LeagueTiers = []string{"pebble", "bronze", "silver", "gold", "sapphire", "ruby", "emerald", "amethyst", "obsidian", "diamond"}

// WeekStart is the Monday 00:00 UTC that opens the league week containing t.
func WeekStart(t time.Time) time.Time {
	t = t.UTC()
	day := time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.UTC)
	offset := (int(day.Weekday()) + 6) % 7 // days since Monday
	return day.AddDate(0, 0, -offset)
}

type LeagueEntry struct {
	UserID   string
	WeeklyXP int64
	// JoinedAt breaks ties: whoever got there first ranks higher.
	JoinedAt time.Time
}

type Outcome string

const (
	Promoted Outcome = "promoted"
	Stayed   Outcome = "stayed"
	Demoted  Outcome = "demoted"
)

type LeagueResult struct {
	UserID  string  `json:"userId"`
	Rank    int     `json:"rank"`
	Outcome Outcome `json:"outcome"`
	Tier    int     `json:"tier"` // the tier for next week
}

// Zones returns how many players of a cohort of size move up and down. A
// full cohort promotes PromoteTop and demotes DemoteLast; smaller cohorts
// (common while Prior is young) scale both down and never let them overlap.
func Zones(size int) (promote, demote int) {
	if size <= 0 {
		return 0, 0
	}
	promote = min(size, max(1, int(math.Round(float64(size*PromoteTop)/CohortSize))))
	demote = min(size-promote, int(math.Round(float64(size*DemoteLast)/CohortSize)))
	return min(promote, PromoteTop), min(demote, DemoteLast)
}

// CloseCohort ranks a finished cohort at tier and decides who moves. Nobody
// is promoted without XP that week, the top tier cannot promote and the
// bottom tier cannot demote.
func CloseCohort(tier int, entries []LeagueEntry) []LeagueResult {
	ranked := append([]LeagueEntry(nil), entries...)
	sort.SliceStable(ranked, func(i, j int) bool {
		if ranked[i].WeeklyXP != ranked[j].WeeklyXP {
			return ranked[i].WeeklyXP > ranked[j].WeeklyXP
		}
		return ranked[i].JoinedAt.Before(ranked[j].JoinedAt)
	})
	promote, demote := Zones(len(ranked))
	results := make([]LeagueResult, len(ranked))
	for index, entry := range ranked {
		result := LeagueResult{UserID: entry.UserID, Rank: index + 1, Outcome: Stayed, Tier: tier}
		switch {
		case index < promote && entry.WeeklyXP > 0 && tier < len(LeagueTiers)-1:
			result.Outcome, result.Tier = Promoted, tier+1
		case index >= len(ranked)-demote && tier > 0:
			result.Outcome, result.Tier = Demoted, tier-1
		}
		results[index] = result
	}
	return results
}
