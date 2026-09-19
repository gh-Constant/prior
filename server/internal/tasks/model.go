package tasks

import "time"

type Task struct {
	ID             string     `json:"id"`
	Title          string     `json:"title"`
	Description    string     `json:"description"`
	DueDate        *string    `json:"dueDate,omitempty"`
	DueTime        *string    `json:"dueTime,omitempty"`
	Priority       int        `json:"priority"`
	AreaID         *string    `json:"areaId,omitempty"`
	ProjectID      *string    `json:"projectId,omitempty"`
	Status         string     `json:"status"`
	ScheduledDate  *string    `json:"scheduledDate,omitempty"`
	ScheduledTime  *string    `json:"scheduledTime,omitempty"`
	AssigneeName   string     `json:"assigneeName"`
	FollowUpDate   *string    `json:"followUpDate,omitempty"`
	FollowUpTime   *string    `json:"followUpTime,omitempty"`
	PeopleIDs      []string   `json:"peopleIds,omitempty"`
	Completed      bool       `json:"completed"`
	Important      bool       `json:"important"`
	Urgent         bool       `json:"urgent"`
	CreatedAt      time.Time  `json:"createdAt"`
	UpdatedAt      time.Time  `json:"updatedAt"`
	DeletedAt      *time.Time `json:"deletedAt"`
	ServerRevision int64      `json:"serverRevision,omitempty"`
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
