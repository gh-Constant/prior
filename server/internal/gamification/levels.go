package gamification

import "math"

// The level curve has no cap. Reaching level L takes XPToReach(L) total XP,
// calibrated for an active user earning about 150 XP a day: level 10 in about
// two weeks, level 20 in about eight, level 50 in under a year and level 100
// in a few years. The client mirrors this in app/src/lib/gamification/rules.ts.
const (
	curveScale    = 30
	curveExponent = 1.9
)

// XPToReach is the total XP needed to reach level (level 1 needs none).
func XPToReach(level int) int64 {
	if level <= 1 {
		return 0
	}
	return int64(math.Floor(curveScale * math.Pow(float64(level-1), curveExponent)))
}

// Progress places a total XP amount on the curve.
type Progress struct {
	Level int `json:"level"`
	// XP earned inside the current level, and XP the level takes in total.
	XPInLevel  int64 `json:"xpInLevel"`
	XPForLevel int64 `json:"xpForLevel"`
}

func ProgressFor(totalXP int64) Progress {
	if totalXP < 0 {
		totalXP = 0
	}
	// Invert the curve for a close guess, then settle exactly.
	level := 1 + int(math.Pow(float64(totalXP)/curveScale, 1/curveExponent))
	for level > 1 && XPToReach(level) > totalXP {
		level--
	}
	for XPToReach(level+1) <= totalXP {
		level++
	}
	floor := XPToReach(level)
	return Progress{Level: level, XPInLevel: totalXP - floor, XPForLevel: XPToReach(level+1) - floor}
}

// Ranks are named every ten levels.
var ranks = []string{"spark", "ember", "flame", "blaze", "nova", "comet", "star", "nebula", "galaxy", "infinity"}

func RankFor(level int) string {
	return ranks[min(max(level, 1)/10, len(ranks)-1)]
}

// NameEffect is a cosmetic style for a player's name, unlocked by level.
type NameEffect string

var nameEffects = []struct {
	ID    NameEffect
	Level int
}{
	{"plain", 1}, {"copper", 5}, {"silver", 10}, {"gold", 20}, {"emerald", 30},
	{"sapphire", 40}, {"diamond", 50}, {"aurora", 75}, {"mythic", 100},
}

// NameEffectsUnlocked lists the name effects available at a level, in ladder order.
func NameEffectsUnlocked(level int) []NameEffect {
	unlocked := make([]NameEffect, 0, len(nameEffects))
	for _, effect := range nameEffects {
		if level >= effect.Level {
			unlocked = append(unlocked, effect.ID)
		}
	}
	return unlocked
}

// PetStage is the evolution of the pet, driven by level once hatched.
type PetStage string

const (
	StageEgg     PetStage = "egg"
	StageBaby    PetStage = "baby"
	StageYoung   PetStage = "young"
	StageAdult   PetStage = "adult"
	StageRadiant PetStage = "radiant"
)

func PetStageFor(level int, hatched bool) PetStage {
	switch {
	case !hatched:
		return StageEgg
	case level >= 50:
		return StageRadiant
	case level >= 25:
		return StageAdult
	case level >= 10:
		return StageYoung
	default:
		return StageBaby
	}
}
