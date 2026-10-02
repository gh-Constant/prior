package tasks

import (
	"encoding/json"
	"fmt"
	"reflect"
	"testing"
)

const (
	idA = "11111111-1111-4111-8111-111111111111"
	idB = "22222222-2222-4222-8222-222222222222"
	idC = "33333333-3333-4333-8333-333333333333"
)

func decodeTask(t *testing.T, payload string) Task {
	t.Helper()
	var task Task
	if err := json.Unmarshal([]byte(payload), &task); err != nil {
		t.Fatal(err)
	}
	return task
}

func TestResolveAssigneesCompatibility(t *testing.T) {
	stored := []string{idA, idB}
	cases := []struct {
		name    string
		payload string
		stored  []string
		want    []string
	}{
		{"both omitted keep the stored list", `{}`, stored, []string{idA, idB}},
		{"an old client re-sending the first assignee keeps the others", `{"assigneeId":"` + idA + `"}`, stored, []string{idA, idB}},
		{"an old client changing the assignee replaces the list", `{"assigneeId":"` + idC + `"}`, stored, []string{idC}},
		{"an old client re-sending the second assignee replaces the list", `{"assigneeId":"` + idB + `"}`, stored, []string{idB}},
		{"an old client unassigning clears the list", `{"assigneeId":null}`, stored, []string{}},
		{"an old client on an unassigned task", `{"assigneeId":null}`, nil, []string{}},
		{"an old client assigning a new task", `{"assigneeId":"` + idA + `"}`, nil, []string{idA}},
		{"the list wins over assigneeId", `{"assigneeId":"` + idA + `","assigneeIds":["` + idC + `","` + idA + `"]}`, stored, []string{idC, idA}},
		{"the list is de-duplicated and ordered", `{"assigneeIds":["` + idB + `","` + idA + `","` + idB + `"]}`, nil, []string{idB, idA}},
		{"an empty list clears", `{"assigneeIds":[]}`, stored, []string{}},
		{"null clears", `{"assigneeIds":null}`, stored, []string{}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			task := decodeTask(t, tc.payload)
			got, err := task.ResolveAssignees(tc.stored)
			if err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(got, tc.want) {
				t.Fatalf("got %v, want %v", got, tc.want)
			}
		})
	}
}

func TestResolveAssigneesRejectsBadLists(t *testing.T) {
	task := decodeTask(t, `{"assigneeIds":["nope"]}`)
	if _, err := task.ResolveAssignees(nil); err == nil {
		t.Fatal("an invalid id must be refused")
	}
	ids := make([]string, 0, MaxAssignees+1)
	for index := 0; index <= MaxAssignees; index++ {
		ids = append(ids, fmt.Sprintf("00000000-0000-4000-8000-0000000000%02d", index))
	}
	if _, err := NormalizeAssigneeIDs(ids); err == nil {
		t.Fatal("more than MaxAssignees must be refused")
	}
}

func TestSyncStoredAssignees(t *testing.T) {
	a := idA
	task := Task{AssigneeID: &a, AssigneeIDs: []string{idB}}
	task.SyncStoredAssignees() // an older server wrote assignee_id only
	if !reflect.DeepEqual(task.AssigneeIDs, []string{idA}) {
		t.Fatalf("legacy column must win on mismatch: %v", task.AssigneeIDs)
	}
	task = Task{AssigneeIDs: []string{idB, idA}}
	task.SyncStoredAssignees()
	if task.AssigneeID == nil || *task.AssigneeID != idB {
		t.Fatalf("assigneeId must follow the first assignee: %v", task.AssigneeID)
	}
	task = Task{}
	task.SyncStoredAssignees()
	if task.AssigneeIDs == nil || len(task.AssigneeIDs) != 0 || task.AssigneeID != nil {
		t.Fatalf("an unassigned task has an empty list: %v %v", task.AssigneeIDs, task.AssigneeID)
	}
}
