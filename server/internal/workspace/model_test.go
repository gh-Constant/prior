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
