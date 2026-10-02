package tasks

import (
	"encoding/json"
	"time"
)

type Task struct {
	ID               string   `json:"id"`
	Title            string   `json:"title"`
	Description      string   `json:"description"`
	DueDate          *string  `json:"dueDate,omitempty"`
	DueTime          *string  `json:"dueTime,omitempty"`
	Priority         int      `json:"priority"`
	AreaID           *string  `json:"areaId,omitempty"`
	ProjectID        *string  `json:"projectId,omitempty"`
	Status           string   `json:"status"`
	ScheduledDate    *string  `json:"scheduledDate,omitempty"`
	ScheduledTime    *string  `json:"scheduledTime,omitempty"`
	AssigneeName     string   `json:"assigneeName"`
	FollowUpDate     *string  `json:"followUpDate,omitempty"`
	FollowUpTime     *string  `json:"followUpTime,omitempty"`
	EstimatedMinutes *int     `json:"estimatedMinutes,omitempty"`
	PeopleIDs        []string `json:"peopleIds,omitempty"`
	// ReminderAt is an absolute instant (RFC 3339, stored in UTC).
	ReminderAt *string `json:"reminderAt,omitempty"`
	// Checklist is the ordered list of subtasks (at most MaxChecklistItems).
	Checklist []ChecklistItem `json:"checklist,omitempty"`
	// AssigneeID is the one project member responsible for the task.
	AssigneeID *string `json:"assigneeId"`
	// ParentID makes the task a sub-issue of another task of its project.
	ParentID *string `json:"parentId"`
	// MilestoneID names a milestone of the task's project.
	MilestoneID *string `json:"milestoneId"`
	// Relations link the task to others ("blocked_by", "related").
	Relations []TaskRelation `json:"relations"`
	// Recurrence repeats the task: completing it creates the next occurrence.
	Recurrence *TaskRecurrence `json:"recurrence"`
	// StoryPoints sizes the task for agile projects (0-999, multiples of 0.5);
	// nil when not estimated.
	StoryPoints    *float64   `json:"storyPoints"`
	Completed      bool       `json:"completed"`
	Important      bool       `json:"important"`
	Urgent         bool       `json:"urgent"`
	CreatedAt      time.Time  `json:"createdAt"`
	UpdatedAt      time.Time  `json:"updatedAt"`
	DeletedAt      *time.Time `json:"deletedAt"`
	ServerRevision int64      `json:"serverRevision,omitempty"`

	present map[string]bool
}

// TaskRelation links a task to another task.
type TaskRelation struct {
	Type   string `json:"type"`
	TaskID string `json:"taskId"`
}

const (
	RelationBlockedBy = "blocked_by"
	RelationRelated   = "related"
	// MaxTaskRelations caps a task's relations.
	MaxTaskRelations = 50
)

// optionalTaskFields are the fields older clients do not send. When a
// mutation omits one, the server keeps the stored value instead of clearing it.
var optionalTaskFields = []string{"assigneeId", "parentId", "milestoneId", "relations", "recurrence", "storyPoints"}

// UnmarshalJSON records which optional fields the payload carried.
func (task *Task) UnmarshalJSON(data []byte) error {
	type taskAlias Task
	var decoded taskAlias
	if err := json.Unmarshal(data, &decoded); err != nil {
		return err
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		return err
	}
	*task = Task(decoded)
	task.present = make(map[string]bool, len(optionalTaskFields))
	for _, name := range optionalTaskFields {
		_, task.present[name] = fields[name]
	}
	return nil
}

// FieldPresent reports whether a decoded payload carried the optional
// field. Tasks built in Go (not decoded) count every field as present.
func (task Task) FieldPresent(name string) bool {
	if task.present == nil {
		return true
	}
	return task.present[name]
}

// MaxChecklistItems caps a task's checklist.
const MaxChecklistItems = 100

// ChecklistItem is one subtask. Checking it never earns XP.
type ChecklistItem struct {
	ID       string `json:"id"`
	Title    string `json:"title"`
	Done     bool   `json:"done"`
	Position int    `json:"position"`
}

type Habit struct {
	ID             string     `json:"id"`
	Title          string     `json:"title"`
	Important      bool       `json:"important"`
	Urgent         bool       `json:"urgent"`
	Interval       int        `json:"interval"`
	Unit           string     `json:"unit"`
	StartDate      string     `json:"startDate"`
	TimeOfDay      *string    `json:"timeOfDay,omitempty"`
	EndDate        *string    `json:"endDate,omitempty"`
	DaysOfWeek     []int      `json:"daysOfWeek"`
	CompletedDates []string   `json:"completedDates"`
	CreatedAt      time.Time  `json:"createdAt"`
	UpdatedAt      time.Time  `json:"updatedAt"`
	DeletedAt      *time.Time `json:"deletedAt"`
	ServerRevision int64      `json:"serverRevision,omitempty"`
}

type Mutation struct {
	ID        string `json:"id"`
	Kind      string `json:"kind"`
	Entity    string `json:"entity,omitempty"`
	Task      Task   `json:"task,omitempty"`
	Habit     Habit  `json:"habit,omitempty"`
	CreatedAt string `json:"createdAt"`
}
