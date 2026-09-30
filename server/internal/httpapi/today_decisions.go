package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

// Today recommendations with the decision model (Jev). The client sends the
// same JSON prompt to every provider (todayRecommendationInput in
// app/src/lib/todayRecommendations.ts) and expects back
// {"summary","focus":[{"taskId","reason","suggestedStart"}],"tips"}.
//
// Jev scores every open task for "worth focusing on today" in one call.
// Code does what Jev is unreliable at: it turns dates into words ("overdue by
// 2 days") before Jev reads them, picks start times from the free slot the
// client computed, and writes the summary, reasons and tips in the user's
// language. When anything fails the hosted chat model answers instead.

type todayPlanInput struct {
	Language                   string   `json:"language"`
	LocalDateTime              string   `json:"localDateTime"`
	AvailableFocusMinutesToday *float64 `json:"availableFocusMinutesToday"`
	NextFreeFocusSlot          *struct {
		Start string `json:"start"`
		End   string `json:"end"`
	} `json:"nextFreeFocusSlot"`
	Tasks    []todayPlanTask  `json:"tasks"`
	Calendar []todayPlanEvent `json:"calendar"`
}

type todayPlanTask struct {
	ID            string `json:"id"`
	Title         string `json:"title"`
	Status        string `json:"status"`
	Priority      int    `json:"priority"`
	Important     bool   `json:"important"`
	Urgent        bool   `json:"urgent"`
	DueDate       string `json:"dueDate"`
	ScheduledDate string `json:"scheduledDate"`
	ScheduledTime string `json:"scheduledTime"`
	FollowUpDate  string `json:"followUpDate"`
}

type todayPlanEvent struct {
	Title     string `json:"title"`
	Date      string `json:"date"`
	StartTime string `json:"startTime"`
	EndTime   string `json:"endTime"`
}

type todayFocus struct {
	TaskID         string  `json:"taskId"`
	Reason         string  `json:"reason"`
	SuggestedStart *string `json:"suggestedStart"`
}

type todayRecommendationOutput struct {
	Summary string       `json:"summary"`
	Focus   []todayFocus `json:"focus"`
	Tips    []string     `json:"tips"`
}

const (
	todayMaxTasks = 20
	todayMaxFocus = 3
	todayMaxTips  = 2
	// Tasks scoring below this (0-4 scale) are not worth a focus slot.
	todayFocusThreshold = 1.5
	// Scores closer than this are a tie that code breaks by deadline.
	todayScoreTie = 0.1
	// Matches DAY_END_MINUTES in app/src/lib/todayPlan.ts.
	todayDayEndMinutes = 19 * 60
)

// todayFocusLevels are the Score levels, lowest first. Concrete situations
// rather than degrees, as TypeSafe recommends.
var todayFocusLevels = []string{
	"Not for today: it is planned for a later day, or it is a vague idea with nothing tying it to now",
	"Can wait: no deadline soon, not important, nothing ties it to today",
	"Useful progress today, but nothing is lost if it slips to another day",
	"Should be done today: due within a few days, planned for today, important, or already in progress",
	"Must be done today: overdue, due today, or both important and urgent",
}

var clockPattern = regexp.MustCompile(`^(?:[01]\d|2[0-3]):[0-5]\d$`)

func parseTodayPlanInput(prompt string) (todayPlanInput, time.Time, error) {
	var input todayPlanInput
	if err := json.Unmarshal([]byte(prompt), &input); err != nil {
		return input, time.Time{}, errors.New("recommendation input is not the expected JSON")
	}
	now, err := time.ParseInLocation("2006-01-02 15:04", strings.TrimSpace(input.LocalDateTime), time.UTC)
	if err != nil {
		return input, time.Time{}, errors.New("recommendation input has no local time")
	}
	if len(input.Tasks) > todayMaxTasks {
		input.Tasks = input.Tasks[:todayMaxTasks]
	}
	return input, now, nil
}

// dayOffset is the number of calendar days from today to an ISO date (or
// datetime), and false when the value is not a date.
func dayOffset(value string, today time.Time) (int, bool) {
	if len(value) < 10 {
		return 0, false
	}
	date, err := time.ParseInLocation("2006-01-02", value[:10], time.UTC)
	if err != nil {
		return 0, false
	}
	return int(date.Sub(today).Hours() / 24), true
}

func clockMinutes(value string) (int, bool) {
	if !clockPattern.MatchString(value) {
		return 0, false
	}
	hours, _ := strconv.Atoi(value[:2])
	minutes, _ := strconv.Atoi(value[3:])
	return hours*60 + minutes, true
}

// todayFact is one reason a task matters today, in display order.
type todayFact struct {
	kind  string
	n     int
	clock string
}

type todayCandidate struct {
	task  todayPlanTask
	facts []todayFact
	// dueIn is the days until the deadline (negative when overdue).
	dueIn      int
	hasDue     bool
	plannedAt  string
	score      float64
	questionID string
}

// todayCandidates keeps the tasks that can be focus work today (not waiting,
// not done, not deliberately planned for a later day) with their facts.
func todayCandidates(tasks []todayPlanTask, now time.Time) []todayCandidate {
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	nowMinutes := now.Hour()*60 + now.Minute()
	candidates := make([]todayCandidate, 0, len(tasks))
	seen := map[string]bool{}
	for _, task := range tasks {
		task.ID = strings.TrimSpace(task.ID)
		task.Title = strings.TrimSpace(redactPII(task.Title))
		if task.ID == "" || seen[task.ID] || task.Title == "" || task.Status == "waiting" || task.Status == "done" {
			continue
		}
		seen[task.ID] = true
		candidate := todayCandidate{task: task}
		candidate.dueIn, candidate.hasDue = dayOffset(task.DueDate, today)
		planned, hasPlan := dayOffset(task.ScheduledDate, today)
		if hasPlan && planned > 0 && !(candidate.hasDue && candidate.dueIn <= 0) {
			continue
		}
		var facts []todayFact
		switch {
		case candidate.hasDue && candidate.dueIn < 0:
			facts = append(facts, todayFact{kind: "overdue", n: -candidate.dueIn})
		case candidate.hasDue && candidate.dueIn == 0:
			facts = append(facts, todayFact{kind: "dueToday"})
		}
		if hasPlan && planned == 0 {
			if minutes, ok := clockMinutes(task.ScheduledTime); ok {
				facts = append(facts, todayFact{kind: "plannedAt", clock: task.ScheduledTime})
				if minutes >= nowMinutes {
					candidate.plannedAt = task.ScheduledTime
				}
			} else {
				facts = append(facts, todayFact{kind: "planned"})
			}
		} else if hasPlan && planned < 0 {
			facts = append(facts, todayFact{kind: "carriedOver"})
		}
		if task.Status == "in_progress" {
			facts = append(facts, todayFact{kind: "inProgress"})
		}
		if candidate.hasDue && candidate.dueIn == 1 {
			facts = append(facts, todayFact{kind: "dueTomorrow"})
		}
		switch {
		case task.Important && task.Urgent:
			facts = append(facts, todayFact{kind: "importantUrgent"})
		case task.Important:
			facts = append(facts, todayFact{kind: "important"})
		case task.Urgent:
			facts = append(facts, todayFact{kind: "urgent"})
		}
		if candidate.hasDue && candidate.dueIn >= 2 && candidate.dueIn <= 7 {
			facts = append(facts, todayFact{kind: "dueInDays", n: candidate.dueIn})
		}
		if task.Priority == 1 || task.Priority == 2 {
			facts = append(facts, todayFact{kind: "priority", n: task.Priority})
		}
		if offset, ok := dayOffset(task.FollowUpDate, today); ok && offset <= 0 {
			facts = append(facts, todayFact{kind: "followUp"})
		}
		if task.Status == "next" {
			facts = append(facts, todayFact{kind: "next"})
		}
		candidate.facts = facts
		candidates = append(candidates, candidate)
	}
	return candidates
}

// jevTaskDescription describes a task for Jev in words: deadlines relative
// to today, never raw dates to compare.
func jevTaskDescription(candidate todayCandidate) map[string]any {
	task := candidate.task
	deadline := "no deadline"
	if candidate.hasDue {
		switch {
		case candidate.dueIn < -1:
			deadline = fmt.Sprintf("overdue by %d days", -candidate.dueIn)
		case candidate.dueIn == -1:
			deadline = "overdue by 1 day"
		case candidate.dueIn == 0:
			deadline = "due today"
		case candidate.dueIn == 1:
			deadline = "due tomorrow"
		case candidate.dueIn <= 7:
			deadline = fmt.Sprintf("due in %d days", candidate.dueIn)
		default:
			deadline = "due in more than a week"
		}
	}
	plan := "not planned for a specific day"
	for _, fact := range candidate.facts {
		switch fact.kind {
		case "plannedAt":
			plan = "planned for today at " + fact.clock
		case "planned":
			plan = "planned for today"
		case "carriedOver":
			plan = "planned for an earlier day and still open"
		}
	}
	status := map[string]string{
		"inbox":       "not triaged yet (inbox)",
		"backlog":     "in the backlog",
		"next":        "marked as next",
		"in_progress": "in progress",
	}[task.Status]
	if status == "" {
		status = "open"
	}
	priority := map[int]string{1: "priority 1 (highest)", 2: "priority 2 (high)", 3: "priority 3 (medium)"}[task.Priority]
	if priority == "" {
		priority = "no priority"
	}
	flags := []string{}
	if task.Important {
		flags = append(flags, "important")
	}
	if task.Urgent {
		flags = append(flags, "urgent")
	}
	title := task.Title
	if len([]rune(title)) > 200 {
		title = string([]rune(title)[:200])
	}
	return map[string]any{
		"title":    title,
		"deadline": deadline,
		"plan":     plan,
		"status":   status,
		"priority": priority,
		"flags":    flags,
	}
}

// todayDecisionRequest builds one Score question per candidate, all against
// the same description of the day.
func todayDecisionRequest(model string, input todayPlanInput, now time.Time, candidates []todayCandidate) decisionRequest {
	part := "morning"
	if now.Hour() >= 18 {
		part = "evening"
	} else if now.Hour() >= 12 {
		part = "afternoon"
	}
	freeTime := "unknown"
	if input.AvailableFocusMinutesToday != nil {
		minutes := int(*input.AvailableFocusMinutesToday)
		if minutes <= 0 {
			freeTime = "none"
		} else {
			freeTime = fmt.Sprintf("%d h %02d min", minutes/60, minutes%60)
		}
	}
	calendar := []string{}
	today := now.Format("2006-01-02")
	for _, event := range input.Calendar {
		if event.Date != today || len(calendar) >= 8 {
			continue
		}
		title := strings.TrimSpace(redactPII(event.Title))
		if len([]rune(title)) > 120 {
			title = string([]rune(title)[:120])
		}
		if clockPattern.MatchString(event.StartTime) {
			calendar = append(calendar, strings.TrimSuffix(event.StartTime+"-"+event.EndTime, "-")+" "+title)
		} else {
			calendar = append(calendar, "all day: "+title)
		}
	}
	state := map[string]any{
		"moment":            fmt.Sprintf("%s %s, %s", now.Weekday(), part, now.Format("15:04")),
		"freeTimeLeftToday": freeTime,
		"calendarToday":     calendar,
		"openTasks":         len(candidates),
	}
	questions := make(map[string]decisionQuestion, len(candidates))
	for index := range candidates {
		id := fmt.Sprintf("t%d", index)
		candidates[index].questionID = id
		questions[id] = decisionQuestion{
			Type: "score",
			Instructions: map[string]any{
				"question": "How much should the user focus on this task today?",
				"task":     jevTaskDescription(candidates[index]),
			},
			Criteria: todayFocusLevels,
		}
	}
	return decisionRequest{Model: model, State: state, Questions: questions}
}

// todayUrgencyLess breaks score ties: earlier deadline, then higher
// priority, then importance.
func todayUrgencyLess(left, right todayCandidate) bool {
	leftDue, rightDue := 1<<20, 1<<20
	if left.hasDue {
		leftDue = left.dueIn
	}
	if right.hasDue {
		rightDue = right.dueIn
	}
	if leftDue != rightDue {
		return leftDue < rightDue
	}
	leftPriority, rightPriority := left.task.Priority, right.task.Priority
	if leftPriority < 1 || leftPriority > 4 {
		leftPriority = 4
	}
	if rightPriority < 1 || rightPriority > 4 {
		rightPriority = 4
	}
	if leftPriority != rightPriority {
		return leftPriority < rightPriority
	}
	return left.task.Important && !right.task.Important
}

// rankTodayCandidates keeps the best-scored tasks above the threshold.
func rankTodayCandidates(candidates []todayCandidate) []todayCandidate {
	ranked := make([]todayCandidate, 0, len(candidates))
	for _, candidate := range candidates {
		if candidate.score >= todayFocusThreshold {
			ranked = append(ranked, candidate)
		}
	}
	sort.SliceStable(ranked, func(i, j int) bool {
		if diff := ranked[i].score - ranked[j].score; diff > todayScoreTie || diff < -todayScoreTie {
			return diff > 0
		}
		return todayUrgencyLess(ranked[i], ranked[j])
	})
	if len(ranked) > todayMaxFocus {
		ranked = ranked[:todayMaxFocus]
	}
	return ranked
}

// buildTodayRecommendation writes the answer the client parses, in the
// user's language.
func buildTodayRecommendation(input todayPlanInput, now time.Time, candidates, focus []todayCandidate) todayRecommendationOutput {
	words := todayCopyFor(input.Language)
	nowMinutes := now.Hour()*60 + now.Minute()
	var slotStart, slotEnd string
	slotMinutes := 0
	if slot := input.NextFreeFocusSlot; slot != nil {
		start, okStart := clockMinutes(slot.Start)
		end, okEnd := clockMinutes(slot.End)
		if okStart && okEnd && start >= nowMinutes && end > start {
			slotStart, slotEnd, slotMinutes = slot.Start, slot.End, end-start
		}
	}
	output := todayRecommendationOutput{Focus: []todayFocus{}, Tips: []string{}}
	slotTaken := false
	for _, candidate := range focus {
		item := todayFocus{TaskID: candidate.task.ID, Reason: words.reason(candidate.facts)}
		switch {
		case candidate.plannedAt != "":
			start := candidate.plannedAt
			item.SuggestedStart = &start
		case !slotTaken && slotStart != "":
			start := slotStart
			item.SuggestedStart = &start
			slotTaken = true
		}
		output.Focus = append(output.Focus, item)
	}

	if len(focus) == 0 {
		output.Summary = words.summaryNone
	} else {
		at := ""
		if start := output.Focus[0].SuggestedStart; start != nil {
			at = fill(words.at, "time", *start)
		}
		template := words.summaryMany
		if len(focus) == 1 {
			template = words.summaryOne
		}
		output.Summary = fill(template, "n", strconv.Itoa(len(focus)), "title", shortTitle(focus[0].task.Title), "time", at)
	}

	overdue, inbox := 0, 0
	for _, candidate := range candidates {
		if candidate.hasDue && candidate.dueIn < 0 {
			overdue++
		}
		if candidate.task.Status == "inbox" {
			inbox++
		}
	}
	if overdue >= 3 {
		output.Tips = append(output.Tips, fill(words.tipOverdue, "n", strconv.Itoa(overdue)))
	}
	if len(focus) > 0 {
		free := -1
		if input.AvailableFocusMinutesToday != nil {
			free = int(*input.AvailableFocusMinutesToday)
		}
		switch {
		case nowMinutes >= todayDayEndMinutes:
			output.Tips = append(output.Tips, words.tipEvening)
		case free == 0:
			output.Tips = append(output.Tips, words.tipFull)
		case free > 0 && free < 60:
			output.Tips = append(output.Tips, words.tipShort)
		case slotTaken && slotMinutes >= 60 && output.Focus[0].SuggestedStart != nil && *output.Focus[0].SuggestedStart == slotStart:
			output.Tips = append(output.Tips, fill(words.tipBlock, "start", slotStart, "end", slotEnd, "title", shortTitle(focus[0].task.Title)))
		}
	}
	if inbox >= 5 {
		output.Tips = append(output.Tips, fill(words.tipInbox, "n", strconv.Itoa(inbox)))
	}
	if len(focus) >= 2 {
		output.Tips = append(output.Tips, words.tipOneAtATime)
	}
	if len(output.Tips) > todayMaxTips {
		output.Tips = output.Tips[:todayMaxTips]
	}
	return output
}

func shortTitle(title string) string {
	runes := []rune(strings.TrimSpace(title))
	if len(runes) > 60 {
		return strings.TrimSpace(string(runes[:59])) + "…"
	}
	return string(runes)
}

// fill replaces {key} placeholders: fill("Due in {n} days", "n", "3").
func fill(template string, pairs ...string) string {
	replacements := make([]string, 0, len(pairs))
	for index := 0; index+1 < len(pairs); index += 2 {
		replacements = append(replacements, "{"+pairs[index]+"}", pairs[index+1])
	}
	return strings.NewReplacer(replacements...).Replace(template)
}

// jevTodayRecommendations answers a hosted "recommendations" completion with
// the decision model. The returned content has the chat model's JSON shape.
func (s *Server) jevTodayRecommendations(ctx context.Context, prompt string) (string, decisionResult, error) {
	input, now, err := parseTodayPlanInput(prompt)
	if err != nil {
		return "", decisionResult{}, err
	}
	candidates := todayCandidates(input.Tasks, now)
	result := decisionResult{model: s.cfg.HostedAI.DecisionsModel}
	if len(candidates) > 0 {
		result, err = s.requestDecisions(ctx, todayDecisionRequest(s.cfg.HostedAI.DecisionsModel, input, now, candidates))
		if err != nil {
			return "", decisionResult{}, err
		}
		answered := 0
		for index := range candidates {
			candidates[index].score = result.scoreOf(candidates[index].questionID)
			if candidates[index].score >= 0 {
				answered++
			}
		}
		if answered == 0 {
			return "", decisionResult{}, errors.New("decision service answered no question")
		}
	}
	encoded, err := json.Marshal(buildTodayRecommendation(input, now, candidates, rankTodayCandidates(candidates)))
	if err != nil {
		return "", decisionResult{}, errors.New("unable to encode recommendations")
	}
	return string(encoded), result, nil
}
