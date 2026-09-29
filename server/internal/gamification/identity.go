package gamification

import (
	"math/rand/v2"
	"regexp"
	"slices"
	"strings"
	"time"
	// Embed the time zone database: the production image (Alpine) ships
	// none, and players' zones (e.g. Europe/Paris) must always resolve.
	_ "time/tzdata"
)

var handlePattern = regexp.MustCompile(`^[a-z0-9_]{3,20}$`)

// Handles that could impersonate Prior or its staff are refused as a
// prefix; generic words only when they are the whole handle.
var (
	reservedPrefixes = []string{"prior", "admin", "support", "staff", "moderator", "official"}
	reservedHandles  = []string{"anonymous", "help", "root", "system", "team", "me", "you"}
)

// Profanity in the languages Prior ships (en, fr, de, es, pt). Unambiguous
// stems are refused anywhere in the handle; words that also occur inside
// innocent ones ("computer", "brochure", "grapefruit") only as a whole word
// between underscores or digits.
var (
	blockedStems = []string{"fuck", "shit", "cunt", "nigg", "faggot", "hitler", "porn", "whore", "salope", "connard", "encul", "schlampe", "fotze", "wichser", "mierda", "pendejo", "caralho", "buceta"}
	blockedWords = []string{"rape", "nazi", "slut", "bitch", "dick", "pussy", "fag", "merde", "pute", "batard", "hure", "puta", "cabron", "porra", "viado"}
)

// NormalizeHandle lowercases and trims a requested handle.
func NormalizeHandle(raw string) string {
	return strings.ToLower(strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(raw), "@")))
}

// HandleProblem explains why a normalized handle is refused ("format",
// "reserved" or "blocked"), or is empty when it is acceptable. Uniqueness is
// checked by the database.
func HandleProblem(handle string) string {
	if !handlePattern.MatchString(handle) {
		return "format"
	}
	for _, prefix := range reservedPrefixes {
		if strings.HasPrefix(handle, prefix) {
			return "reserved"
		}
	}
	if slices.Contains(reservedHandles, handle) {
		return "reserved"
	}
	// Leetspeak digits are folded so "sh1t" is caught too.
	folded := strings.NewReplacer("0", "o", "1", "i", "3", "e", "4", "a", "5", "s", "7", "t").Replace(handle)
	for _, stem := range blockedStems {
		if strings.Contains(folded, stem) {
			return "blocked"
		}
	}
	isSeparator := func(r rune) bool { return r == '_' || (r >= '0' && r <= '9') }
	for _, word := range append(strings.FieldsFunc(handle, isSeparator), strings.Split(folded, "_")...) {
		if slices.Contains(blockedWords, word) {
			return "blocked"
		}
	}
	return ""
}

// Anonymous players are shown as "Anonymous <Animal>", translated on the client.
var anonymousAnimals = []string{"otter", "fox", "owl", "panda", "koala", "lynx", "heron", "badger", "falcon", "seal", "hedgehog", "raccoon", "moose", "gecko", "puffin", "wombat"}

func RandomAnonymousKey(rng *rand.Rand) string {
	return anonymousAnimals[rng.IntN(len(anonymousAnimals))]
}

// HabitCheckInEligible limits habit XP to check-ins for today or yesterday,
// so ticking old dates in bulk earns nothing.
func HabitCheckInEligible(date, today string) bool {
	day, err1 := time.Parse(time.DateOnly, date)
	now, err2 := time.Parse(time.DateOnly, today)
	if err1 != nil || err2 != nil {
		return false
	}
	diff := daysBetween(day, now)
	return diff == 0 || diff == 1
}

// ConsecutiveDays counts the run of consecutive calendar days in dates that
// ends on upTo (inclusive). Order and duplicates in dates do not matter.
func ConsecutiveDays(dates []string, upTo string) int {
	set := make(map[string]bool, len(dates))
	for _, date := range dates {
		set[date] = true
	}
	day, err := time.Parse(time.DateOnly, upTo)
	if err != nil {
		return 0
	}
	count := 0
	for set[day.Format(time.DateOnly)] {
		count++
		day = day.AddDate(0, 0, -1)
	}
	return count
}

// LoadLocation resolves a user's IANA time zone, falling back to UTC.
func LoadLocation(name string) *time.Location {
	if name == "" {
		return time.UTC
	}
	location, err := time.LoadLocation(name)
	if err != nil {
		return time.UTC
	}
	return location
}
