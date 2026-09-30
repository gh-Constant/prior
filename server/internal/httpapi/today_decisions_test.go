package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gh-Constant/prior/server/internal/config"
)

func decisionTestServer(t *testing.T, handler http.HandlerFunc) (*Server, *httptest.Server) {
	t.Helper()
	upstream := httptest.NewServer(handler)
	t.Cleanup(upstream.Close)
	server := &Server{
		completionClient: upstream.Client(),
		cfg: config.Config{HostedAI: config.HostedAIConfig{
			APIKey:         "sk-or-secret",
			DecisionsURL:   upstream.URL,
			DecisionsModel: "typesafe/jev-1.13",
		}},
	}
	return server, upstream
}

func TestRequestDecisions(t *testing.T) {
	var gotAuth string
	var gotBody decisionRequest
	server, _ := decisionTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		_ = json.NewDecoder(r.Body).Decode(&gotBody)
		_, _ = w.Write([]byte(`{"model":"typesafe/jev-1.13-20260917","answers":{"a":{"type":"score","score":2.5,"confidence":0.9,"probabilities":{"0":0,"1":0.1,"2":0.3,"3":0.6}},"b":{"type":"noul","noul":0.2}},"usage":{"input_tokens":400,"output_tokens":20,"cost":0.0000168}}`))
	})
	result, err := server.requestDecisions(context.Background(), decisionRequest{
		Model: "typesafe/jev-1.13",
		State: map[string]any{"x": 1},
		Questions: map[string]decisionQuestion{
			"a": {Type: "score", Instructions: "How much?", Criteria: []string{"low", "high"}},
		},
	})
	if err != nil {
		t.Fatalf("request failed: %v", err)
	}
	if gotAuth != "Bearer sk-or-secret" || gotBody.Model != "typesafe/jev-1.13" || gotBody.Questions["a"].Type != "score" {
		t.Fatalf("auth=%q body=%+v", gotAuth, gotBody)
	}
	if result.model != "typesafe/jev-1.13-20260917" || result.totalTokens != 420 || result.costMicros != 17 {
		t.Fatalf("unexpected result: %+v", result)
	}
	if got := result.scoreOf("a"); got != 2.5 {
		t.Fatalf("score a = %v", got)
	}
	if got := result.scoreOf("b"); got != -1 {
		t.Fatalf("a noul answer has no score, got %v", got)
	}
	if got := result.scoreOf("missing"); got != -1 {
		t.Fatalf("missing answers score -1, got %v", got)
	}
}

func TestRequestDecisionsHidesUpstreamErrors(t *testing.T) {
	server, _ := decisionTestServer(t, func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, `{"error":"invalid key sk-or-secret"}`, http.StatusUnauthorized)
	})
	_, err := server.requestDecisions(context.Background(), decisionRequest{Model: "m", State: "s", Questions: map[string]decisionQuestion{}})
	if err == nil || strings.Contains(err.Error(), "sk-or") {
		t.Fatalf("expected a sanitized error, got %v", err)
	}
}

func TestDecisionsDisabledWithoutURLOrModel(t *testing.T) {
	for _, cfg := range []config.HostedAIConfig{
		{APIKey: "k", DecisionsModel: "typesafe/jev-1.13"},
		{APIKey: "k", DecisionsURL: "https://example.test/decisions"},
		{DecisionsURL: "https://example.test/decisions", DecisionsModel: "typesafe/jev-1.13"},
	} {
		if cfg.DecisionsEnabled() {
			t.Fatalf("decisions must be disabled for %+v", cfg)
		}
	}
}

func TestTodayCandidatesFactsAndExclusions(t *testing.T) {
	now := time.Date(2026, 9, 30, 10, 0, 0, 0, time.UTC)
	candidates := todayCandidates([]todayPlanTask{
		{ID: "late", Title: "Send the invoice", DueDate: "2026-09-28", Important: true, Priority: 1},
		{ID: "today", Title: "Call the bank", ScheduledDate: "2026-09-30", ScheduledTime: "14:30", Status: "in_progress"},
		{ID: "waiting", Title: "Wait for Léa", Status: "waiting"},
		{ID: "later", Title: "Plan the trip", ScheduledDate: "2026-10-03"},
		{ID: "later-but-due", Title: "Renew passport", ScheduledDate: "2026-10-03", DueDate: "2026-09-30"},
		{ID: "late", Title: "Duplicate id"},
		{ID: "soon", Title: "Mail bob@example.com", DueDate: "2026-10-02T09:00:00Z", Urgent: true},
		{ID: "", Title: "No id"},
	}, now)
	ids := []string{}
	for _, candidate := range candidates {
		ids = append(ids, candidate.task.ID)
	}
	if strings.Join(ids, ",") != "late,today,later-but-due,soon" {
		t.Fatalf("candidates = %v", ids)
	}
	kinds := func(candidate todayCandidate) string {
		parts := []string{}
		for _, fact := range candidate.facts {
			parts = append(parts, fact.kind)
		}
		return strings.Join(parts, ",")
	}
	if got := kinds(candidates[0]); got != "overdue,important,priority" || candidates[0].facts[0].n != 2 {
		t.Fatalf("late facts = %s %+v", got, candidates[0].facts)
	}
	if got := kinds(candidates[1]); got != "plannedAt,inProgress" || candidates[1].plannedAt != "14:30" {
		t.Fatalf("today facts = %s, plannedAt %q", got, candidates[1].plannedAt)
	}
	if got := kinds(candidates[3]); got != "urgent,dueInDays" || candidates[3].dueIn != 2 {
		t.Fatalf("soon facts = %s, dueIn %d", got, candidates[3].dueIn)
	}
	if strings.Contains(candidates[3].task.Title, "@") {
		t.Fatalf("emails must be redacted before reaching the model: %q", candidates[3].task.Title)
	}
}

func TestTodayDecisionRequestDescribesTasksInWords(t *testing.T) {
	now := time.Date(2026, 9, 30, 15, 5, 0, 0, time.UTC)
	free := 130.0
	input := todayPlanInput{
		AvailableFocusMinutesToday: &free,
		Calendar: []todayPlanEvent{
			{Title: "Team sync", Date: "2026-09-30", StartTime: "16:00", EndTime: "17:00"},
			{Title: "Tomorrow", Date: "2026-10-01", StartTime: "09:00"},
		},
	}
	candidates := todayCandidates([]todayPlanTask{{ID: "a", Title: "Write report", DueDate: "2026-09-29", Priority: 2}}, now)
	request := todayDecisionRequest("typesafe/jev-1.13", input, now, candidates)
	encoded, _ := json.Marshal(request)
	text := string(encoded)
	for _, want := range []string{`"Wednesday afternoon, 15:05"`, `"2 h 10 min"`, `"16:00-17:00 Team sync"`, `"overdue by 1 day"`, `"priority 2 (high)"`, `"type":"score"`} {
		if !strings.Contains(text, want) {
			t.Fatalf("request lacks %s: %s", want, text)
		}
	}
	if strings.Contains(text, "2026-09-29") || strings.Contains(text, "Tomorrow") {
		t.Fatalf("raw dates and other days' events must not reach the model: %s", text)
	}
	if candidates[0].questionID != "t0" || len(request.Questions) != 1 || len(todayFocusLevels) != 5 {
		t.Fatalf("unexpected questions: %+v", request.Questions)
	}
}

func TestJevTodayRecommendations(t *testing.T) {
	var calls atomic.Int32
	server, _ := decisionTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		var request decisionRequest
		_ = json.NewDecoder(r.Body).Decode(&request)
		scores := map[string]float64{}
		for key, question := range request.Questions {
			task := question.Instructions.(map[string]any)["task"].(map[string]any)
			switch task["title"] {
			case "Send the invoice":
				scores[key] = 3.9
			case "Call the bank":
				scores[key] = 3.3
			case "Tidy the garage":
				scores[key] = 0.6
			case "Read a book":
				scores[key] = 3.35
			}
		}
		answers := map[string]any{}
		for key, score := range scores {
			answers[key] = map[string]any{"type": "score", "score": score, "confidence": 0.8}
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"model": "typesafe/jev-1.13-20260917", "answers": answers, "usage": map[string]any{"input_tokens": 900, "output_tokens": 40, "cost": 0.00004}})
	})
	prompt := `{"language":"fr","localDateTime":"2026-09-30 10:02","availableFocusMinutesToday":300,"nextFreeFocusSlot":{"start":"10:05","end":"12:00"},
		"tasks":[
			{"id":"garage","title":"Tidy the garage","status":"backlog","priority":4,"important":false,"urgent":false,"dueDate":null,"scheduledDate":null,"scheduledTime":null,"followUpDate":null},
			{"id":"bank","title":"Call the bank","status":"next","priority":3,"important":false,"urgent":false,"dueDate":null,"scheduledDate":"2026-09-30","scheduledTime":"14:30","followUpDate":null},
			{"id":"invoice","title":"Send the invoice","status":"inbox","priority":1,"important":true,"urgent":false,"dueDate":"2026-09-28","scheduledDate":null,"scheduledTime":null,"followUpDate":null},
			{"id":"book","title":"Read a book","status":"inbox","priority":2,"important":false,"urgent":false,"dueDate":"2026-10-03","scheduledDate":null,"scheduledTime":null,"followUpDate":null}
		],"calendar":[]}`
	content, result, err := server.jevTodayRecommendations(context.Background(), prompt)
	if err != nil {
		t.Fatalf("recommendations failed: %v", err)
	}
	if calls.Load() != 1 || result.totalTokens != 940 || result.costMicros != 40 || result.model != "typesafe/jev-1.13-20260917" {
		t.Fatalf("calls=%d result=%+v", calls.Load(), result)
	}
	var output todayRecommendationOutput
	if err := json.Unmarshal([]byte(content), &output); err != nil {
		t.Fatalf("content is not JSON: %v\n%s", err, content)
	}
	if len(output.Focus) != 3 {
		t.Fatalf("focus = %+v", output.Focus)
	}
	// "Call the bank" (3.3) and "Read a book" (3.35) tie: the one with a
	// deadline comes first.
	order := []string{output.Focus[0].TaskID, output.Focus[1].TaskID, output.Focus[2].TaskID}
	if strings.Join(order, ",") != "invoice,book,bank" {
		t.Fatalf("order = %v", order)
	}
	if output.Focus[0].Reason != "En retard de 2 jours · Marquée importante" {
		t.Fatalf("reason = %q", output.Focus[0].Reason)
	}
	if start := output.Focus[0].SuggestedStart; start == nil || *start != "10:05" {
		t.Fatalf("the first focus task takes the free slot, got %v", start)
	}
	if output.Focus[1].SuggestedStart != nil {
		t.Fatalf("only one task gets the free slot, got %v", *output.Focus[1].SuggestedStart)
	}
	if start := output.Focus[2].SuggestedStart; start == nil || *start != "14:30" {
		t.Fatalf("a task planned at a time keeps it, got %v", start)
	}
	if output.Summary != "3 tâches ressortent aujourd'hui : commencez par « Send the invoice » à 10:05." {
		t.Fatalf("summary = %q", output.Summary)
	}
	if len(output.Tips) != 2 || !strings.HasPrefix(output.Tips[0], "Bloquez 10:05–12:00") || !strings.HasPrefix(output.Tips[1], "Une tâche à la fois") {
		t.Fatalf("tips = %q", output.Tips)
	}
}

func TestJevTodayRecommendationsWithoutCandidatesSkipsTheModel(t *testing.T) {
	var calls atomic.Int32
	server, _ := decisionTestServer(t, func(w http.ResponseWriter, _ *http.Request) {
		calls.Add(1)
		http.Error(w, "unexpected", http.StatusInternalServerError)
	})
	content, _, err := server.jevTodayRecommendations(context.Background(), `{"language":"en","localDateTime":"2026-09-30 20:00","tasks":[{"id":"w","title":"Wait","status":"waiting"}],"calendar":[]}`)
	if err != nil || calls.Load() != 0 {
		t.Fatalf("err=%v calls=%d", err, calls.Load())
	}
	if content != `{"summary":"Nothing pressing stands out today.","focus":[],"tips":[]}` {
		t.Fatalf("content = %s", content)
	}
}

func TestJevTodayRecommendationsFailsSoTheChatModelAnswers(t *testing.T) {
	server, _ := decisionTestServer(t, func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"model":"m","answers":{},"usage":{}}`))
	})
	task := `{"id":"a","title":"Write","status":"inbox","priority":4}`
	for name, prompt := range map[string]string{
		"not json":      "Plan my day",
		"no local time": `{"language":"en","tasks":[` + task + `]}`,
		"no answers":    `{"language":"en","localDateTime":"2026-09-30 09:00","tasks":[` + task + `]}`,
	} {
		if _, _, err := server.jevTodayRecommendations(context.Background(), prompt); err == nil {
			t.Fatalf("%s: expected an error so the chat model takes over", name)
		}
	}
}

func TestTodayTipsForTheEndOfTheDayAndABusyBacklog(t *testing.T) {
	now := time.Date(2026, 9, 30, 20, 0, 0, 0, time.UTC)
	free := 0.0
	tasks := []todayPlanTask{}
	for _, id := range []string{"a", "b", "c", "d", "e"} {
		tasks = append(tasks, todayPlanTask{ID: id, Title: "Task " + id, Status: "inbox", DueDate: "2026-09-27"})
	}
	candidates := todayCandidates(tasks, now)
	for index := range candidates {
		candidates[index].score = 3
	}
	output := buildTodayRecommendation(todayPlanInput{Language: "de-DE", AvailableFocusMinutesToday: &free}, now, candidates, rankTodayCandidates(candidates))
	if len(output.Focus) != todayMaxFocus || output.Focus[0].SuggestedStart != nil {
		t.Fatalf("focus = %+v", output.Focus)
	}
	if len(output.Tips) != 2 || output.Tips[0] != "5 Aufgaben sind überfällig: Plane die, die du heute nicht schaffst, neu ein." || !strings.HasPrefix(output.Tips[1], "Der Tag geht zu Ende") {
		t.Fatalf("tips = %q", output.Tips)
	}
	if output.Summary != "Heute stechen 3 Aufgaben heraus: Beginne mit „Task a“." {
		t.Fatalf("summary = %q", output.Summary)
	}
}

func TestTodayCopiesAreComplete(t *testing.T) {
	for language, words := range todayCopies {
		for _, fact := range []todayFact{{kind: "overdue", n: 1}, {kind: "overdue", n: 3}, {kind: "dueToday"}, {kind: "dueTomorrow"}, {kind: "dueInDays", n: 3}, {kind: "plannedAt", clock: "09:00"}, {kind: "planned"}, {kind: "carriedOver"}, {kind: "inProgress"}, {kind: "importantUrgent"}, {kind: "important"}, {kind: "urgent"}, {kind: "priority", n: 1}, {kind: "next"}, {kind: "followUp"}} {
			if text := words.fact(fact); text == "" || strings.Contains(text, "{") {
				t.Fatalf("%s: fact %+v renders %q", language, fact, text)
			}
		}
		for name, text := range map[string]string{"fallback": words.fallback, "summaryOne": words.summaryOne, "summaryMany": words.summaryMany, "summaryNone": words.summaryNone, "at": words.at, "tipOverdue": words.tipOverdue, "tipFull": words.tipFull, "tipShort": words.tipShort, "tipEvening": words.tipEvening, "tipBlock": words.tipBlock, "tipInbox": words.tipInbox, "tipOneAtATime": words.tipOneAtATime} {
			if strings.TrimSpace(text) == "" {
				t.Fatalf("%s: %s is empty", language, name)
			}
		}
	}
	if todayCopyFor("it").summaryNone != todayCopies["en"].summaryNone || todayCopyFor("PT-br").summaryNone != todayCopies["pt"].summaryNone {
		t.Fatal("unknown languages use English; regional variants use their language")
	}
}
