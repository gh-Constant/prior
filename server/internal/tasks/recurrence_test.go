package tasks

import (
	"strconv"
	"testing"
	"time"
)

func strp(value string) *string { return &value }

func TestNextDueDate(t *testing.T) {
	cases := []struct {
		name        string
		rule        TaskRecurrence
		due         *string
		completedOn string
		today       string
		want        string
	}{
		{"daily", TaskRecurrence{Interval: 1, Unit: "day"}, strp("2026-10-01"), "2026-10-01", "2026-10-01", "2026-10-02"},
		{"every 3 days", TaskRecurrence{Interval: 3, Unit: "day"}, strp("2026-10-01"), "2026-10-01", "2026-10-01", "2026-10-04"},
		{"weekdays from friday", TaskRecurrence{Interval: 1, Unit: "week", DaysOfWeek: []int{1, 2, 3, 4, 5}}, strp("2026-10-02"), "2026-10-02", "2026-10-02", "2026-10-05"},
		{"weekdays within the week", TaskRecurrence{Interval: 1, Unit: "week", DaysOfWeek: []int{1, 2, 3, 4, 5}}, strp("2026-10-05"), "2026-10-05", "2026-10-05", "2026-10-06"},
		{"every 2 weeks monday thursday, from monday", TaskRecurrence{Interval: 2, Unit: "week", DaysOfWeek: []int{1, 4}}, strp("2026-10-05"), "2026-10-05", "2026-10-05", "2026-10-08"},
		{"every 2 weeks monday thursday, from thursday", TaskRecurrence{Interval: 2, Unit: "week", DaysOfWeek: []int{1, 4}}, strp("2026-10-08"), "2026-10-08", "2026-10-08", "2026-10-19"},
		{"sunday counts as the end of the week", TaskRecurrence{Interval: 1, Unit: "week", DaysOfWeek: []int{0, 1}}, strp("2026-10-04"), "2026-10-04", "2026-10-04", "2026-10-05"},
		{"weekly without days", TaskRecurrence{Interval: 1, Unit: "week"}, strp("2026-10-01"), "2026-10-01", "2026-10-01", "2026-10-08"},
		{"monthly clamps the 31st", TaskRecurrence{Interval: 1, Unit: "month"}, strp("2026-01-31"), "2026-01-31", "2026-01-31", "2026-02-28"},
		{"monthly keeps the 31st while skipping", TaskRecurrence{Interval: 1, Unit: "month"}, strp("2026-01-31"), "2026-04-10", "2026-04-10", "2026-04-30"},
		{"monthly keeps the 31st when it exists", TaskRecurrence{Interval: 1, Unit: "month"}, strp("2026-01-31"), "2026-03-02", "2026-03-02", "2026-03-31"},
		{"yearly feb 29", TaskRecurrence{Interval: 1, Unit: "year"}, strp("2024-02-29"), "2024-02-29", "2024-02-29", "2025-02-28"},
		{"yearly feb 29 back to a leap year", TaskRecurrence{Interval: 1, Unit: "year"}, strp("2024-02-29"), "2028-01-01", "2028-01-01", "2028-02-29"},
		{"basis completion", TaskRecurrence{Interval: 2, Unit: "day", Basis: "completion"}, strp("2026-10-01"), "2026-10-05", "2026-10-05", "2026-10-07"},
		{"basis due skips the past", TaskRecurrence{Interval: 2, Unit: "day"}, strp("2026-10-01"), "2026-10-05", "2026-10-05", "2026-10-05"},
		{"daily overdue lands today", TaskRecurrence{Interval: 1, Unit: "day"}, strp("2026-09-20"), "2026-10-01", "2026-10-01", "2026-10-01"},
		{"no due date counts from today", TaskRecurrence{Interval: 1, Unit: "day"}, nil, "2026-10-01", "2026-10-01", "2026-10-02"},
		{"month interval across a year end", TaskRecurrence{Interval: 3, Unit: "month"}, strp("2026-11-30"), "2026-11-30", "2026-11-30", "2027-02-28"},
		{"until inclusive", TaskRecurrence{Interval: 1, Unit: "week", Until: strp("2026-10-12")}, strp("2026-10-05"), "2026-10-05", "2026-10-05", "2026-10-12"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rule := tc.rule
			got, ok := NextDueDate(&rule, tc.due, tc.completedOn, tc.today)
			if !ok || got != tc.want {
				t.Fatalf("next = %q (ok %v), want %q", got, ok, tc.want)
			}
		})
	}
	ended := TaskRecurrence{Interval: 1, Unit: "week", Until: strp("2026-10-10")}
	if got, ok := NextDueDate(&ended, strp("2026-10-05"), "2026-10-05", "2026-10-05"); ok {
		t.Fatalf("past the end date must stop, got %q", got)
	}
	if _, ok := NextDueDate(&TaskRecurrence{Interval: 0, Unit: "day"}, nil, "2026-10-01", "2026-10-01"); ok {
		t.Fatal("an invalid rule has no next date")
	}
}

func TestNormalizeRecurrence(t *testing.T) {
	if rule, err := NormalizeRecurrence(nil); rule != nil || err != nil {
		t.Fatalf("nil stays nil: %v %v", rule, err)
	}
	rule, err := NormalizeRecurrence(&TaskRecurrence{Interval: 2, Unit: "week", DaysOfWeek: []int{4, 1, 4}, Basis: "due", Until: strp(" 2026-12-31 ")})
	if err != nil || rule.Basis != "" || len(rule.DaysOfWeek) != 2 || rule.DaysOfWeek[0] != 1 || *rule.Until != "2026-12-31" {
		t.Fatalf("canonical form = %+v %v", rule, err)
	}
	if rule, _ := NormalizeRecurrence(&TaskRecurrence{Interval: 1, Unit: "day", DaysOfWeek: []int{1}}); rule.DaysOfWeek != nil {
		t.Fatalf("days only apply to weekly rules: %+v", rule)
	}
	for _, bad := range []TaskRecurrence{
		{Interval: 0, Unit: "day"},
		{Interval: MaxRecurrenceInterval + 1, Unit: "day"},
		{Interval: 1, Unit: "hour"},
		{Interval: 1, Unit: "week", DaysOfWeek: []int{7}},
		{Interval: 1, Unit: "day", Basis: "sometimes"},
		{Interval: 1, Unit: "day", Until: strp("tomorrow")},
	} {
		candidate := bad
		if _, err := NormalizeRecurrence(&candidate); err == nil {
			t.Errorf("%+v must be refused", bad)
		}
	}
}

func TestNextOccurrence(t *testing.T) {
	now := time.Date(2026, 10, 1, 12, 0, 0, 0, time.UTC)
	counter := 0
	newID := func() string { counter++; return "id-" + strconv.Itoa(counter) }
	due, scheduled, reminder := "2026-10-01", "2026-09-30", "2026-10-01T07:00:00Z"
	task := Task{
		ID: "old", Title: "Water plants", Description: "Balcony", Priority: 2, Status: "done", Completed: true,
		DueDate: &due, ScheduledDate: &scheduled, ReminderAt: &reminder, FollowUpDate: &due, AssigneeName: "Lea",
		Checklist:  []ChecklistItem{{ID: "a", Title: "Fern", Done: true, Position: 0}, {ID: "b", Title: "Cactus", Done: true, Position: 1}},
		Relations:  []TaskRelation{{Type: RelationRelated, TaskID: "other"}},
		Recurrence: &TaskRecurrence{Interval: 1, Unit: "week", DaysOfWeek: []int{1, 4}},
	}
	next := NextOccurrence(task, now, "in_progress", newID, now)
	if next == nil {
		t.Fatal("a weekly task has a next occurrence")
	}
	if next.ID == "old" || next.Completed || next.Status != "next" || next.Title != "Water plants" || next.Priority != 2 {
		t.Fatalf("occurrence = %+v", next)
	}
	// Thursday 2026-10-01 -> Monday 2026-10-05: everything dated moves 4 days.
	if *next.DueDate != "2026-10-05" || *next.ScheduledDate != "2026-10-04" || *next.ReminderAt != "2026-10-05T07:00:00Z" {
		t.Fatalf("dates = %v %v %v", *next.DueDate, *next.ScheduledDate, *next.ReminderAt)
	}
	if next.FollowUpDate != nil || next.AssigneeName != "" || next.DeletedAt != nil {
		t.Fatalf("follow-up and waiting-on are not carried: %+v", next)
	}
	if len(next.Checklist) != 2 || next.Checklist[0].Done || next.Checklist[0].ID == "a" || next.Checklist[1].Position != 1 {
		t.Fatalf("checklist = %+v", next.Checklist)
	}
	if next.Recurrence == nil || next.Recurrence.Interval != 1 || len(next.Relations) != 1 {
		t.Fatalf("rule and relations are kept: %+v", next)
	}
	if !next.CreatedAt.Equal(now) || next.ServerRevision != 0 {
		t.Fatalf("fresh timestamps: %+v", next)
	}
	if task.Checklist[0].ID != "a" || !task.Checklist[0].Done {
		t.Fatal("the completed task must not be modified")
	}
	// An inbox task stays in the inbox.
	task.Status = "done"
	if again := NextOccurrence(task, now, "inbox", newID, now); again.Status != "inbox" {
		t.Fatalf("status = %s", again.Status)
	}
	// Past the end date the series stops.
	task.Recurrence = &TaskRecurrence{Interval: 1, Unit: "day", Until: strp("2026-10-01")}
	if NextOccurrence(task, now, "next", newID, now) != nil {
		t.Fatal("no occurrence past the end date")
	}
	task.Recurrence = nil
	if NextOccurrence(task, now, "next", newID, now) != nil {
		t.Fatal("a task without a rule does not repeat")
	}
}

func TestTaskDecodingTracksRecurrence(t *testing.T) {
	var with, without Task
	if err := with.UnmarshalJSON([]byte(`{"id":"1","recurrence":null}`)); err != nil {
		t.Fatal(err)
	}
	if err := without.UnmarshalJSON([]byte(`{"id":"1"}`)); err != nil {
		t.Fatal(err)
	}
	if !with.FieldPresent("recurrence") || without.FieldPresent("recurrence") {
		t.Fatal("recurrence must follow the omitted-field semantics")
	}
	var parsed Task
	if err := parsed.UnmarshalJSON([]byte(`{"id":"1","recurrence":{"interval":2,"unit":"week","daysOfWeek":[1,4],"basis":"completion","until":"2026-12-31"}}`)); err != nil {
		t.Fatal(err)
	}
	if parsed.Recurrence == nil || parsed.Recurrence.Interval != 2 || parsed.Recurrence.Basis != "completion" || *parsed.Recurrence.Until != "2026-12-31" {
		t.Fatalf("parsed = %+v", parsed.Recurrence)
	}
}
