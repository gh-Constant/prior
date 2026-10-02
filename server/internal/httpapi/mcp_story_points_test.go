package httpapi

import (
	"bytes"
	"encoding/csv"
	"strings"
	"testing"
	"time"

	"github.com/gh-Constant/prior/server/internal/tasks"
)

func TestMCPStoryPoints(t *testing.T) {
	backend := &fakeMCPBackend{}
	handler := newTestMCP(backend)

	text, isError := callTool(t, handler, "create_task", `{"title":"Sized","story_points":5}`)
	if isError {
		t.Fatalf("create_task failed: %s", text)
	}
	created := backend.tasks[0]
	if created.StoryPoints == nil || *created.StoryPoints != 5 {
		t.Fatalf("story points = %v", created.StoryPoints)
	}

	// Half points are fine, and an omitted argument keeps the estimate.
	if text, isError = callTool(t, handler, "update_task", `{"id":"`+created.ID+`","story_points":0.5}`); isError {
		t.Fatalf("update_task failed: %s", text)
	}
	if got := backend.tasks[0].StoryPoints; got == nil || *got != 0.5 {
		t.Fatalf("after update = %v", got)
	}
	if text, isError = callTool(t, handler, "update_task", `{"id":"`+created.ID+`","title":"Renamed"}`); isError {
		t.Fatalf("update_task failed: %s", text)
	}
	if got := backend.tasks[0].StoryPoints; got == nil || *got != 0.5 {
		t.Fatalf("an omitted story_points must be kept, got %v", got)
	}

	// The list shows them, and null clears the estimate.
	text, isError = callTool(t, handler, "list_tasks", `{}`)
	if isError || !strings.Contains(text, `"storyPoints": 0.5`) {
		t.Fatalf("list_tasks = %s %v", text, isError)
	}
	if text, isError = callTool(t, handler, "update_task", `{"id":"`+created.ID+`","story_points":null}`); isError {
		t.Fatalf("update_task failed: %s", text)
	}
	if backend.tasks[0].StoryPoints != nil {
		t.Fatalf("null must clear, got %v", *backend.tasks[0].StoryPoints)
	}

	for _, bad := range []string{`-1`, `1000`, `2.3`, `"five"`, `true`} {
		if _, isError = callTool(t, handler, "update_task", `{"id":"`+created.ID+`","story_points":`+bad+`}`); !isError {
			t.Errorf("story_points %s must be refused", bad)
		}
	}
}

func TestMCPStoryPointsSchema(t *testing.T) {
	for _, nullable := range []bool{false, true} {
		property, ok := taskFieldProperties(nullable)["story_points"].(map[string]any)
		if !ok {
			t.Fatalf("story_points is missing from the schema (nullable=%v)", nullable)
		}
		if property["multipleOf"] != 0.5 || property["maximum"] != tasks.MaxStoryPoints {
			t.Errorf("schema = %v", property)
		}
	}
}

func TestTasksCSVHasStoryPoints(t *testing.T) {
	five, half := 5.0, 0.5
	moment := time.Date(2026, 10, 1, 9, 0, 0, 0, time.UTC)
	var out bytes.Buffer
	err := writeTasksCSV(&out, []tasks.Task{
		{ID: "a", Title: "Sized", Status: "next", Priority: 4, StoryPoints: &five, CreatedAt: moment, UpdatedAt: moment},
		{ID: "b", Title: "Half", Status: "next", Priority: 4, StoryPoints: &half, CreatedAt: moment, UpdatedAt: moment},
		{ID: "c", Title: "Plain", Status: "next", Priority: 4, CreatedAt: moment, UpdatedAt: moment},
	})
	if err != nil {
		t.Fatal(err)
	}
	rows, err := csv.NewReader(&out).ReadAll()
	if err != nil {
		t.Fatal(err)
	}
	column := -1
	for index, name := range rows[0] {
		if name == "storyPoints" {
			column = index
		}
	}
	if column < 0 {
		t.Fatalf("no storyPoints column in %v", rows[0])
	}
	for index, want := range []string{"5", "0.5", ""} {
		if got := rows[index+1][column]; got != want {
			t.Errorf("row %d storyPoints = %q, want %q", index+1, got, want)
		}
		if len(rows[index+1]) != len(rows[0]) {
			t.Errorf("row %d has %d cells for %d columns", index+1, len(rows[index+1]), len(rows[0]))
		}
	}
}
