package tasks

import (
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"
)

// Recurring tasks (specs/RECURRING_TASKS.md). This is the same algorithm as
// app/src/lib/recurrence.ts: keep the two in sync.

const (
	dateLayout = "2006-01-02"
	// MaxRecurrenceInterval caps "every N units".
	MaxRecurrenceInterval = 365
	// RecurrenceBasisCompletion counts the next date from the completion day.
	RecurrenceBasisCompletion = "completion"
	// RecurrenceBasisDue (the default) counts from the due date.
	RecurrenceBasisDue    = "due"
	maxSkippedOccurrences = 20000
)

// TaskRecurrence is a repeat rule: completing the task creates the next one.
type TaskRecurrence struct {
	// Interval repeats every N units (1-365).
	Interval int `json:"interval"`
	// Unit is "day", "week", "month" or "year".
	Unit string `json:"unit"`
	// DaysOfWeek lists JS weekdays (0 = Sunday) for weekly rules.
	DaysOfWeek []int `json:"daysOfWeek,omitempty"`
	// Basis is "completion" to count from the day the task was completed.
	// The default ("due", stored as empty) counts from the due date.
	Basis string `json:"basis,omitempty"`
	// Until is the last allowed occurrence (YYYY-MM-DD, inclusive).
	Until *string `json:"until,omitempty"`
}

// NormalizeRecurrence validates a rule and returns its canonical form: days
// only for weekly rules (sorted, unique), a basis only when it is
// "completion", an end date only when it is a real date. nil stays nil.
func NormalizeRecurrence(rule *TaskRecurrence) (*TaskRecurrence, error) {
	if rule == nil {
		return nil, nil
	}
	if rule.Interval < 1 || rule.Interval > MaxRecurrenceInterval {
		return nil, fmt.Errorf("recurrence interval must be between 1 and %d", MaxRecurrenceInterval)
	}
	switch rule.Unit {
	case "day", "week", "month", "year":
	default:
		return nil, errors.New("recurrence unit must be day, week, month or year")
	}
	result := &TaskRecurrence{Interval: rule.Interval, Unit: rule.Unit}
	if rule.Unit == "week" && len(rule.DaysOfWeek) > 0 {
		seen := map[int]bool{}
		for _, day := range rule.DaysOfWeek {
			if day < 0 || day > 6 {
				return nil, errors.New("recurrence days of week must be between 0 (Sunday) and 6")
			}
			if !seen[day] {
				seen[day] = true
				result.DaysOfWeek = append(result.DaysOfWeek, day)
			}
		}
		sort.Ints(result.DaysOfWeek)
	}
	switch rule.Basis {
	case "", RecurrenceBasisDue:
	case RecurrenceBasisCompletion:
		result.Basis = RecurrenceBasisCompletion
	default:
		return nil, errors.New("recurrence basis must be due or completion")
	}
	if rule.Until != nil && strings.TrimSpace(*rule.Until) != "" {
		until := strings.TrimSpace(*rule.Until)
		if _, err := time.Parse(dateLayout, until); err != nil {
			return nil, errors.New("recurrence end date must use the format YYYY-MM-DD")
		}
		result.Until = &until
	}
	return result, nil
}

func epochDay(date time.Time) int64 {
	return time.Date(date.Year(), date.Month(), date.Day(), 0, 0, 0, 0, time.UTC).Unix() / 86400
}

func dateFromEpochDay(days int64) time.Time {
	return time.Unix(days*86400, 0).UTC()
}

func daysIn(year int, month time.Month) int {
	return time.Date(year, month+1, 0, 0, 0, 0, 0, time.UTC).Day()
}

// mondayFirst numbers weekdays so that a week runs Monday to Sunday.
func mondayFirst(weekday int) int { return (weekday + 6) % 7 }

type recurrenceAnchor struct {
	day   int
	month time.Month
}

func stepRecurrence(rule *TaskRecurrence, from int64, anchor recurrenceAnchor) int64 {
	interval := int64(rule.Interval)
	switch rule.Unit {
	case "day":
		return from + interval
	case "week":
		if len(rule.DaysOfWeek) == 0 {
			return from + 7*interval
		}
		keys := make([]int, 0, len(rule.DaysOfWeek))
		for _, day := range rule.DaysOfWeek {
			keys = append(keys, mondayFirst(day))
		}
		sort.Ints(keys)
		current := mondayFirst(int(dateFromEpochDay(from).Weekday()))
		for _, key := range keys {
			if key > current {
				return from + int64(key-current)
			}
		}
		return from + 7*interval - int64(current) + int64(keys[0])
	case "month":
		date := dateFromEpochDay(from)
		total := date.Year()*12 + int(date.Month()) - 1 + rule.Interval
		year, month := total/12, time.Month(total%12+1)
		return epochDay(time.Date(year, month, min(anchor.day, daysIn(year, month)), 0, 0, 0, 0, time.UTC))
	default:
		year := dateFromEpochDay(from).Year() + rule.Interval
		return epochDay(time.Date(year, anchor.month, min(anchor.day, daysIn(year, anchor.month)), 0, 0, 0, 0, time.UTC))
	}
}

// NextDueDate is the date (YYYY-MM-DD) of the next occurrence after a
// completion, or ok=false when the series has ended or the input is unusable.
//
// Basis "due" counts from dueDate (today when there is none) and skips
// occurrences already in the past; basis "completion" counts from completedOn.
// Monthly and yearly rules keep the base date's day within one call (Jan 31,
// Feb 28, Mar 31 while skipping) and clamp it to the month length; across
// completions the clamped date becomes the base.
func NextDueDate(rule *TaskRecurrence, dueDate *string, completedOn, today string) (string, bool) {
	normalized, err := NormalizeRecurrence(rule)
	if err != nil || normalized == nil {
		return "", false
	}
	todayDate, err := time.Parse(dateLayout, today)
	if err != nil {
		return "", false
	}
	completed := todayDate
	if parsed, err := time.Parse(dateLayout, completedOn); err == nil {
		completed = parsed
	}
	base := todayDate
	if normalized.Basis == RecurrenceBasisCompletion {
		base = completed
	} else if dueDate != nil {
		if parsed, err := time.Parse(dateLayout, *dueDate); err == nil {
			base = parsed
		}
	}
	anchor := recurrenceAnchor{day: base.Day(), month: base.Month()}
	todayDay := epochDay(todayDate)
	candidate := stepRecurrence(normalized, epochDay(base), anchor)
	if normalized.Basis != RecurrenceBasisCompletion {
		for skipped := 0; candidate < todayDay && skipped < maxSkippedOccurrences; skipped++ {
			candidate = stepRecurrence(normalized, candidate, anchor)
		}
		if candidate < todayDay {
			return "", false
		}
	}
	next := dateFromEpochDay(candidate).Format(dateLayout)
	if normalized.Until != nil && next > *normalized.Until {
		return "", false
	}
	return next, true
}

// NextOccurrence builds the next occurrence of a task that was just completed
// (task.Recurrence set), or nil when the series has ended. today is the
// caller's current date; previousStatus the task's status before completion.
// The reminder is shifted by whole days of 24 hours (the server does not know
// the user's time zone; clients shift in local calendar days).
func NextOccurrence(task Task, today time.Time, previousStatus string, newID func() string, now time.Time) *Task {
	rule, err := NormalizeRecurrence(task.Recurrence)
	if err != nil || rule == nil {
		return nil
	}
	todayKey := today.Format(dateLayout)
	next, ok := NextDueDate(rule, task.DueDate, todayKey, todayKey)
	if !ok {
		return nil
	}
	oldDue := todayKey
	if task.DueDate != nil {
		if _, err := time.Parse(dateLayout, *task.DueDate); err == nil {
			oldDue = *task.DueDate
		}
	}
	oldDay, _ := time.Parse(dateLayout, oldDue)
	nextDay, _ := time.Parse(dateLayout, next)
	shift := epochDay(nextDay) - epochDay(oldDay)

	status := previousStatus
	if status == "" {
		status = task.Status
	}
	switch status {
	case "in_progress", "waiting", "done":
		status = "next"
	}
	occurrence := task
	occurrence.ID = newID()
	occurrence.Status = status
	occurrence.Completed = false
	occurrence.DueDate = &next
	occurrence.ScheduledDate = nil
	if task.ScheduledDate != nil {
		if scheduled, err := time.Parse(dateLayout, *task.ScheduledDate); err == nil {
			shifted := dateFromEpochDay(epochDay(scheduled) + shift).Format(dateLayout)
			occurrence.ScheduledDate = &shifted
		}
	}
	occurrence.ReminderAt = nil
	if task.ReminderAt != nil {
		if reminder, err := time.Parse(time.RFC3339, *task.ReminderAt); err == nil {
			shifted := reminder.AddDate(0, 0, int(shift)).UTC().Format(time.RFC3339)
			occurrence.ReminderAt = &shifted
		}
	}
	occurrence.FollowUpDate = nil
	occurrence.FollowUpTime = nil
	occurrence.AssigneeName = ""
	occurrence.Checklist = nil
	for position, item := range task.Checklist {
		occurrence.Checklist = append(occurrence.Checklist, ChecklistItem{ID: newID(), Title: item.Title, Done: false, Position: position})
	}
	occurrence.Relations = append([]TaskRelation{}, task.Relations...)
	occurrence.Recurrence = rule
	occurrence.CreatedAt = now.UTC()
	occurrence.UpdatedAt = now.UTC()
	occurrence.DeletedAt = nil
	occurrence.ServerRevision = 0
	occurrence.present = nil
	return &occurrence
}
