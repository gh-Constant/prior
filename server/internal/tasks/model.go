package tasks

import "time"

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
	Checklist      []ChecklistItem `json:"checklist,omitempty"`
	Completed      bool            `json:"completed"`
	Important      bool            `json:"important"`
	Urgent         bool            `json:"urgent"`
	CreatedAt      time.Time       `json:"createdAt"`
	UpdatedAt      time.Time       `json:"updatedAt"`
	DeletedAt      *time.Time      `json:"deletedAt"`
	ServerRevision int64           `json:"serverRevision,omitempty"`
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
