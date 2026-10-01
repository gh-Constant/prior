package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strings"
	"sync"
)

// Time-blocking estimates with the decision model (Jev). The client's
// planner (app/src/lib/timeBlocking.ts) places tasks itself; it only asks
// Prior AI how long each new task takes, whether it needs deep focus, and
// how much it matters. Those are typed judgements, so Jev answers them for a
// fraction of a chat model's cost and there is no chat-model fallback: on
// any error the client keeps its local estimates.
//
// Input (planningEstimateInput in app/src/lib/planning.ts):
//   {"language":"fr","tasks":[{"id","title","description","checklist":[...]}]}
// Output: {"tasks":[{"id","minutes","energy":"deep"|"light","value"}]}

type planningInput struct {
	Language string         `json:"language"`
	Tasks    []planningTask `json:"tasks"`
}

type planningTask struct {
	ID          string   `json:"id"`
	Title       string   `json:"title"`
	Description string   `json:"description"`
	Checklist   []string `json:"checklist"`
}

type planningEstimate struct {
	ID      string   `json:"id"`
	Minutes int      `json:"minutes"`
	Energy  string   `json:"energy"`
	Value   *float64 `json:"value,omitempty"`
}

const (
	planningMaxTasks = 30
	// Tasks per decision call: three questions each.
	planningBatch = 10
)

// planningDurationLevels are the duration Score levels, shortest first, and
// planningDurationMinutes the minutes each level stands for.
var planningDurationLevels = []string{
	"5 to 15 minutes: a quick action such as a call, a short reply, a payment, a booking or a purchase",
	"About 30 minutes: a small piece of work such as a detailed email, a form, a short review or tidying up notes",
	"About 1 hour: a solid piece of work such as preparing a meeting, fixing a bug, a short document or a lesson",
	"About 2 hours: substantial work such as writing a report section, designing a feature or studying a chapter",
	"Half a day or more: large work such as a full report, a presentation from scratch, an exam revision or a big feature",
}

var planningDurationMinutes = []float64{15, 30, 60, 120, 240}

var planningValueLevels = []string{
	"Trivial: nothing changes if it is never done",
	"Minor: a small convenience",
	"Useful: a real but modest benefit",
	"Important: clear consequences for the user's work, studies, money, health or relationships",
	"Critical: serious consequences if it is not done",
}

var planningEnergyOptions = map[string]string{
	"deep":  "Needs sustained concentration without interruptions: writing, coding, designing, studying, analysing, planning",
	"light": "Routine or reactive work that fits between other things: calls, emails, admin, errands, purchases, small fixes, tidying",
}

func parsePlanningInput(prompt string) (planningInput, error) {
	var input planningInput
	if err := json.Unmarshal([]byte(prompt), &input); err != nil {
		return input, errors.New("planning input is not the expected JSON")
	}
	tasks := make([]planningTask, 0, len(input.Tasks))
	seen := map[string]bool{}
	for _, task := range input.Tasks {
		task.ID = strings.TrimSpace(task.ID)
		task.Title = truncateRunes(strings.TrimSpace(redactPII(task.Title)), 200)
		if task.ID == "" || seen[task.ID] || task.Title == "" {
			continue
		}
		seen[task.ID] = true
		task.Description = truncateRunes(strings.TrimSpace(redactPII(task.Description)), 240)
		checklist := make([]string, 0, len(task.Checklist))
		for _, item := range task.Checklist {
			if item = truncateRunes(strings.TrimSpace(redactPII(item)), 80); item != "" && len(checklist) < 12 {
				checklist = append(checklist, item)
			}
		}
		task.Checklist = checklist
		tasks = append(tasks, task)
		if len(tasks) == planningMaxTasks {
			break
		}
	}
	input.Tasks = tasks
	return input, nil
}

func truncateRunes(value string, limit int) string {
	runes := []rune(value)
	if len(runes) > limit {
		return string(runes[:limit])
	}
	return value
}

func planningTaskDescription(task planningTask) map[string]any {
	description := map[string]any{"title": task.Title}
	if task.Description != "" {
		description["details"] = task.Description
	}
	if len(task.Checklist) > 0 {
		description["steps"] = task.Checklist
	}
	return description
}

func planningDecisionRequest(model string, tasks []planningTask) decisionRequest {
	questions := make(map[string]decisionQuestion, len(tasks)*3)
	for index, task := range tasks {
		description := planningTaskDescription(task)
		questions[fmt.Sprintf("d%d", index)] = decisionQuestion{
			Type: "score",
			Instructions: map[string]any{
				"question": "How much focused working time will it take to actually do this task (not waiting time)?",
				"task":     description,
			},
			Criteria: planningDurationLevels,
		}
		questions[fmt.Sprintf("e%d", index)] = decisionQuestion{
			Type: "choice",
			Instructions: map[string]any{
				"question": "What kind of effort does this task need?",
				"task":     description,
			},
			Criteria: planningEnergyOptions,
		}
		questions[fmt.Sprintf("v%d", index)] = decisionQuestion{
			Type: "score",
			Instructions: map[string]any{
				"question": "How much does getting this task done matter to the user?",
				"task":     description,
			},
			Criteria: planningValueLevels,
		}
	}
	state := map[string]any{
		"context": "Tasks from a personal to-do app. The app blocks time in the user's calendar for each task.",
		"tasks":   len(tasks),
	}
	return decisionRequest{Model: model, State: state, Questions: questions}
}

// planningMinutes maps a 0-4 duration score onto minutes, interpolating
// between levels and rounding to 5 minutes.
func planningMinutes(score float64) int {
	score = math.Max(0, math.Min(float64(len(planningDurationMinutes)-1), score))
	low := int(math.Floor(score))
	if low >= len(planningDurationMinutes)-1 {
		return int(planningDurationMinutes[len(planningDurationMinutes)-1])
	}
	fraction := score - float64(low)
	minutes := planningDurationMinutes[low] + fraction*(planningDurationMinutes[low+1]-planningDurationMinutes[low])
	return int(math.Round(minutes/5) * 5)
}

func (r decisionResult) choiceOf(key string) string {
	answer, ok := r.answers[key]
	if !ok {
		return ""
	}
	return strings.TrimSpace(answer.Choice)
}

func planningEstimates(tasks []planningTask, result decisionResult) []planningEstimate {
	estimates := make([]planningEstimate, 0, len(tasks))
	for index, task := range tasks {
		duration := result.scoreOf(fmt.Sprintf("d%d", index))
		if duration < 0 {
			continue
		}
		estimate := planningEstimate{ID: task.ID, Minutes: planningMinutes(duration), Energy: "light"}
		if result.choiceOf(fmt.Sprintf("e%d", index)) == "deep" {
			estimate.Energy = "deep"
		}
		if value := result.scoreOf(fmt.Sprintf("v%d", index)); value >= 0 {
			rounded := math.Round(value*100) / 100
			estimate.Value = &rounded
		}
		estimates = append(estimates, estimate)
	}
	return estimates
}

// jevPlanningEstimates answers a hosted "planning" completion. Batches run in
// parallel; usage adds up across them.
func (s *Server) jevPlanningEstimates(ctx context.Context, prompt string) (string, decisionResult, error) {
	input, err := parsePlanningInput(prompt)
	if err != nil {
		return "", decisionResult{}, err
	}
	total := decisionResult{model: s.cfg.HostedAI.DecisionsModel}
	estimates := []planningEstimate{}
	if len(input.Tasks) > 0 {
		type batchResult struct {
			estimates []planningEstimate
			result    decisionResult
			err       error
		}
		batches := make([]batchResult, (len(input.Tasks)+planningBatch-1)/planningBatch)
		var wait sync.WaitGroup
		for index := range batches {
			start := index * planningBatch
			end := min(start+planningBatch, len(input.Tasks))
			tasks := input.Tasks[start:end]
			wait.Add(1)
			go func(slot *batchResult) {
				defer wait.Done()
				result, err := s.requestDecisions(ctx, planningDecisionRequest(s.cfg.HostedAI.DecisionsModel, tasks))
				slot.result, slot.err = result, err
				if err == nil {
					slot.estimates = planningEstimates(tasks, result)
				}
			}(&batches[index])
		}
		wait.Wait()
		var lastErr error
		for _, batch := range batches {
			if batch.err != nil {
				lastErr = batch.err
				continue
			}
			if batch.result.model != "" {
				total.model = batch.result.model
			}
			total.totalTokens += batch.result.totalTokens
			total.costMicros += batch.result.costMicros
			estimates = append(estimates, batch.estimates...)
		}
		if len(estimates) == 0 {
			if lastErr != nil {
				return "", total, lastErr
			}
			return "", total, errors.New("decision service answered no question")
		}
	}
	encoded, err := json.Marshal(map[string]any{"tasks": estimates})
	if err != nil {
		return "", total, errors.New("unable to encode planning estimates")
	}
	return string(encoded), total, nil
}
