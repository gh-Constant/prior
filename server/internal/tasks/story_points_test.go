package tasks

import (
	"encoding/json"
	"math"
	"testing"
)

func TestNormalizeStoryPoints(t *testing.T) {
	fp := func(value float64) *float64 { return &value }
	for _, valid := range []float64{0, 0.5, 1, 5, 13, 998.5, 999} {
		got, err := NormalizeStoryPoints(fp(valid))
		if err != nil || got == nil || *got != valid {
			t.Fatalf("%v must be accepted: %v %v", valid, got, err)
		}
	}
	if got, err := NormalizeStoryPoints(nil); err != nil || got != nil {
		t.Fatalf("nil means not estimated: %v %v", got, err)
	}
	for _, invalid := range []float64{-0.5, -1, 999.5, 1000, 0.3, 2.25, math.NaN(), math.Inf(1), math.Inf(-1)} {
		if _, err := NormalizeStoryPoints(fp(invalid)); err == nil {
			t.Fatalf("%v must be refused", invalid)
		}
	}
}

func TestTaskStoryPointsFieldPresence(t *testing.T) {
	var omitted, cleared, set Task
	if err := json.Unmarshal([]byte(`{"id":"t1","title":"x"}`), &omitted); err != nil {
		t.Fatal(err)
	}
	if omitted.FieldPresent("storyPoints") || omitted.StoryPoints != nil {
		t.Fatalf("omitted = %+v", omitted)
	}
	if err := json.Unmarshal([]byte(`{"id":"t1","title":"x","storyPoints":null}`), &cleared); err != nil {
		t.Fatal(err)
	}
	if !cleared.FieldPresent("storyPoints") || cleared.StoryPoints != nil {
		t.Fatalf("null must be present and clear: %+v", cleared)
	}
	if err := json.Unmarshal([]byte(`{"id":"t1","title":"x","storyPoints":3.5}`), &set); err != nil {
		t.Fatal(err)
	}
	if !set.FieldPresent("storyPoints") || set.StoryPoints == nil || *set.StoryPoints != 3.5 {
		t.Fatalf("value = %+v", set.StoryPoints)
	}
}
