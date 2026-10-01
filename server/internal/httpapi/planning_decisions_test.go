package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync/atomic"
	"testing"
)

func TestPlanningMinutes(t *testing.T) {
	for score, want := range map[float64]int{-1: 15, 0: 15, 0.5: 25, 1: 30, 2: 60, 2.5: 90, 3: 120, 3.5: 180, 4: 240, 9: 240} {
		if got := planningMinutes(score); got != want {
			t.Fatalf("planningMinutes(%v) = %d, want %d", score, got, want)
		}
	}
}

func TestParsePlanningInputCleansTasks(t *testing.T) {
	tasks := []map[string]any{{"id": " a ", "title": "Call jane@example.com", "checklist": []string{"one", " "}}, {"id": "a", "title": "dup"}, {"id": "b", "title": "  "}}
	for index := 0; index < 40; index++ {
		tasks = append(tasks, map[string]any{"id": fmt.Sprintf("x%d", index), "title": "Task"})
	}
	encoded, _ := json.Marshal(map[string]any{"language": "fr", "tasks": tasks})
	input, err := parsePlanningInput(string(encoded))
	if err != nil {
		t.Fatal(err)
	}
	if len(input.Tasks) != planningMaxTasks || input.Tasks[0].ID != "a" || strings.Contains(input.Tasks[0].Title, "jane@example.com") || len(input.Tasks[0].Checklist) != 1 {
		t.Fatalf("unexpected tasks: %+v", input.Tasks[:2])
	}
	if _, err := parsePlanningInput("not json"); err == nil {
		t.Fatal("expected an error for a non-JSON prompt")
	}
}

func TestJevPlanningEstimates(t *testing.T) {
	var calls atomic.Int32
	server, _ := decisionTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		var request decisionRequest
		_ = json.NewDecoder(r.Body).Decode(&request)
		answers := map[string]any{}
		for key, question := range request.Questions {
			switch {
			case strings.HasPrefix(key, "d"):
				answers[key] = map[string]any{"type": "score", "score": 2.0}
			case strings.HasPrefix(key, "e") && question.Type == "choice":
				answers[key] = map[string]any{"type": "choice", "choice": "deep"}
			case strings.HasPrefix(key, "v"):
				answers[key] = map[string]any{"type": "score", "score": 3.0}
			}
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"model": "typesafe/jev-1.13", "answers": answers, "usage": map[string]any{"input_tokens": 100, "output_tokens": 0, "cost": 0.000004}})
	})
	tasks := []map[string]any{}
	for index := 0; index < 12; index++ {
		tasks = append(tasks, map[string]any{"id": fmt.Sprintf("t%d", index), "title": "Write the report"})
	}
	prompt, _ := json.Marshal(map[string]any{"language": "en", "tasks": tasks})
	content, result, err := server.jevPlanningEstimates(context.Background(), string(prompt))
	if err != nil {
		t.Fatal(err)
	}
	if calls.Load() != 2 || result.totalTokens != 200 {
		t.Fatalf("expected two batches, got %d calls and %d tokens", calls.Load(), result.totalTokens)
	}
	var output struct {
		Tasks []planningEstimate `json:"tasks"`
	}
	if err := json.Unmarshal([]byte(content), &output); err != nil {
		t.Fatal(err)
	}
	if len(output.Tasks) != 12 || output.Tasks[0].Minutes != 60 || output.Tasks[0].Energy != "deep" || output.Tasks[0].Value == nil || *output.Tasks[0].Value != 3 {
		t.Fatalf("unexpected estimates: %s", content)
	}
}

func TestJevPlanningEstimatesFailsWithoutAnswers(t *testing.T) {
	server, _ := decisionTestServer(t, func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "nope", http.StatusInternalServerError)
	})
	if _, _, err := server.jevPlanningEstimates(context.Background(), `{"tasks":[{"id":"a","title":"Task"}]}`); err == nil {
		t.Fatal("expected an error when the decision service fails")
	}
	content, _, err := server.jevPlanningEstimates(context.Background(), `{"tasks":[]}`)
	if err != nil || content != `{"tasks":[]}` {
		t.Fatalf("no task means no call: %q %v", content, err)
	}
}
