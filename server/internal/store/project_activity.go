package store

import (
	"context"
	"time"

	"github.com/google/uuid"
)

// ProjectActivityEntry counts, for one day and one person, the tasks of a
// project they completed and created. It feeds the GitHub-style activity
// grid of agile projects.
type ProjectActivityEntry struct {
	Date      string  `json:"date"`
	UserID    *string `json:"userId"`
	Completed int     `json:"completed"`
	Created   int     `json:"created"`
}

// ProjectActivityDays is how far back the activity grid reaches.
const ProjectActivityDays = 371

// ProjectActivity reads the task changelog of a project the user can see.
// A completion is a change that marks a task done when its previous change
// did not; the person is whoever pushed that change. Days are calendar days
// in loc.
func (s *Store) ProjectActivity(ctx context.Context, userID, projectID uuid.UUID, loc *time.Location) ([]ProjectActivityEntry, error) {
	if _, err := s.projectRoleFromPool(ctx, userID, projectID); err != nil {
		return nil, err
	}
	since := time.Now().UTC().AddDate(0, 0, -ProjectActivityDays)
	rows, err := s.pool.Query(ctx, `
		WITH history AS (
			SELECT c.task_id, c.user_id, c.project_id, c.completed, c.deleted_at, c.updated_at,
				LAG(c.completed) OVER (PARTITION BY c.task_id ORDER BY c.revision) AS was_completed,
				ROW_NUMBER() OVER (PARTITION BY c.task_id ORDER BY c.revision) AS position
			FROM task_changes c
			WHERE c.task_id IN (SELECT DISTINCT task_id FROM task_changes WHERE project_id = $1)
		)
		SELECT to_char((updated_at AT TIME ZONE $3)::date, 'YYYY-MM-DD') AS day, user_id::text,
			count(*) FILTER (WHERE completed AND NOT COALESCE(was_completed, false)) AS completed,
			count(*) FILTER (WHERE position = 1) AS created
		FROM history
		WHERE project_id = $1 AND deleted_at IS NULL AND updated_at >= $2
			AND ((completed AND NOT COALESCE(was_completed, false)) OR position = 1)
		GROUP BY day, user_id
		ORDER BY day`, projectID, since, loc.String())
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	entries := make([]ProjectActivityEntry, 0)
	for rows.Next() {
		var entry ProjectActivityEntry
		if err := rows.Scan(&entry.Date, &entry.UserID, &entry.Completed, &entry.Created); err != nil {
			return nil, err
		}
		entries = append(entries, entry)
	}
	return entries, rows.Err()
}
