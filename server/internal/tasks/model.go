package tasks

import "time"

type Task struct {
	ID             string     `json:"id"`
	Title          string     `json:"title"`
	Completed      bool       `json:"completed"`
	Important      bool       `json:"important"`
	Urgent         bool       `json:"urgent"`
	CreatedAt      time.Time  `json:"createdAt"`
	UpdatedAt      time.Time  `json:"updatedAt"`
	DeletedAt      *time.Time `json:"deletedAt"`
	ServerRevision int64      `json:"serverRevision,omitempty"`
}

type Mutation struct {
	ID        string `json:"id"`
	Kind      string `json:"kind"`
	Task      Task   `json:"task"`
	CreatedAt string `json:"createdAt"`
}
