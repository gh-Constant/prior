package workspace

import (
	"testing"
	"time"
)

func testArea(id, name, updatedAt string) Area {
	parsed, _ := time.Parse(time.RFC3339, updatedAt)
	return Area{ID: id, Name: name, Color: "#c96551", CreatedAt: parsed, UpdatedAt: parsed}
}

func TestMergeSnapshotsKeepsIndependentItemsAndNewestVersion(t *testing.T) {
	areaID := "00000000-0000-0000-0000-000000000001"
	projectID := "00000000-0000-0000-0000-000000000002"
	older := testArea(areaID, "Old", "2026-01-01T00:00:00Z")
	newer := testArea(areaID, "Deleted", "2026-01-02T00:00:00Z")
	newer.DeletedAt = &newer.UpdatedAt
	project := Project{ID: projectID, Name: "Project", Description: "", Status: "active", CreatedAt: older.CreatedAt, UpdatedAt: older.UpdatedAt}

	merged, err := MergeSnapshots(Snapshot{Areas: []Area{older}, Projects: []Project{project}}, Snapshot{Areas: []Area{newer}})
	if err != nil {
		t.Fatalf("merge failed: %v", err)
	}
	if len(merged.Areas) != 1 || merged.Areas[0].Name != "Deleted" || merged.Areas[0].DeletedAt == nil {
		t.Fatalf("expected newest area tombstone, got %#v", merged.Areas)
	}
	if len(merged.Projects) != 1 || merged.Projects[0].ID != projectID {
		t.Fatalf("expected unrelated project to survive, got %#v", merged.Projects)
	}
}

func TestSnapshotValidationRejectsInvalidItem(t *testing.T) {
	if _, err := MergeSnapshots(Snapshot{}, Snapshot{Areas: []Area{testArea("not-a-uuid", "Area", "2026-01-01T00:00:00Z")}}); err == nil {
		t.Fatal("expected invalid item id to be rejected")
	}
}

func TestProjectPlanningValidation(t *testing.T) {
	validHealth := ProjectHealthOnTrack
	startDate := "2026-09-01"
	targetDate := "2026-09-30"
	project := Project{
		ID:         "00000000-0000-0000-0000-000000000001",
		Name:       "Planned Project",
		Status:     "active",
		Health:     &validHealth,
		StartDate:  &startDate,
		TargetDate: &targetDate,
		Cycles: []ProjectCycle{
			{
				ID:       "cycle-1",
				Name:     "Sprint 1",
				StartsOn: "2026-09-01",
				EndsOn:   "2026-09-14",
				IssueIDs: []string{"00000000-0000-0000-0000-000000000002"},
			},
		},
	}
	if err := project.ValidatePlanning(); err != nil {
		t.Fatalf("expected valid project planning, got error: %v", err)
	}

	// Invalid health
	badHealth := "Healthy"
	badProject := project
	badProject.Health = &badHealth
	if err := badProject.ValidatePlanning(); err == nil {
		t.Fatal("expected error for invalid health string")
	}

	// Target before start
	earlierTarget := "2026-08-15"
	badProject = project
	badProject.TargetDate = &earlierTarget
	if err := badProject.ValidatePlanning(); err == nil {
		t.Fatal("expected error for target date before start date")
	}

	// Cycle end before cycle start
	badProject = project
	badProject.Cycles = []ProjectCycle{
		{ID: "c1", Name: "C1", StartsOn: "2026-09-10", EndsOn: "2026-09-05"},
	}
	if err := badProject.ValidatePlanning(); err == nil {
		t.Fatal("expected error for cycle end date before start date")
	}

	// Duplicate cycle IDs
	badProject = project
	badProject.Cycles = []ProjectCycle{
		{ID: "c1", Name: "C1", StartsOn: "2026-09-01", EndsOn: "2026-09-10"},
		{ID: "c1", Name: "C2", StartsOn: "2026-09-11", EndsOn: "2026-09-20"},
	}
	if err := badProject.ValidatePlanning(); err == nil {
		t.Fatal("expected error for duplicate cycle IDs")
	}

	// Invalid cycle issue UUID
	badProject = project
	badProject.Cycles = []ProjectCycle{
		{ID: "c1", Name: "C1", StartsOn: "2026-09-01", EndsOn: "2026-09-10", IssueIDs: []string{"not-a-uuid"}},
	}
	if err := badProject.ValidatePlanning(); err == nil {
		t.Fatal("expected error for non-uuid cycle issue id")
	}
}

func TestProjectPlanningUnmarshalJSON(t *testing.T) {
	// Without planning fields
	var legacy Project
	if err := legacy.UnmarshalJSON([]byte(`{"id":"p1","name":"Legacy","status":"active"}`)); err != nil {
		t.Fatalf("unmarshal legacy project failed: %v", err)
	}
	if legacy.PlanningFieldsPresent() {
		t.Fatal("expected PlanningFieldsPresent to be false for legacy payload")
	}

	// With planning fields
	var withPlanning Project
	if err := withPlanning.UnmarshalJSON([]byte(`{"id":"p2","name":"New","status":"active","health":"At risk"}`)); err != nil {
		t.Fatalf("unmarshal project with planning failed: %v", err)
	}
	if !withPlanning.PlanningFieldsPresent() {
		t.Fatal("expected PlanningFieldsPresent to be true when health is provided")
	}
	if withPlanning.Health == nil || *withPlanning.Health != ProjectHealthAtRisk {
		t.Fatalf("expected health %q, got %v", ProjectHealthAtRisk, withPlanning.Health)
	}
}
