package tasks

import (
	"errors"
	"math"
)

// MaxStoryPoints caps a task's story points. The same bound lives in
// app/src/lib/storyPoints.ts: keep the two in sync.
const MaxStoryPoints = 999

// NormalizeStoryPoints validates a task's story points: nil (not estimated)
// or a finite number from 0 to MaxStoryPoints that is a multiple of 0.5.
func NormalizeStoryPoints(points *float64) (*float64, error) {
	if points == nil {
		return nil, nil
	}
	value := *points
	if math.IsNaN(value) || math.IsInf(value, 0) || value < 0 || value > MaxStoryPoints {
		return nil, errors.New("invalid task story points")
	}
	if value*2 != math.Trunc(value*2) {
		return nil, errors.New("task story points must be a multiple of 0.5")
	}
	return &value, nil
}
