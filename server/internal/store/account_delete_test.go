package store

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/gh-Constant/prior/server/internal/tasks"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestDeleteAccountTransfersAndLeavesNoRowsPostgres(t *testing.T) {
	s, pool := newGameTestStore(t)
	ctx := context.Background()
	alice := newGameTestUser(t, s, "alice@delete.test")
	bob := newGameTestUser(t, s, "bob@delete.test")     // editor, joined second
	carol := newGameTestUser(t, s, "carol@delete.test") // viewer, joined first
	dave := newGameTestUser(t, s, "dave@delete.test")

	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, query, args...); err != nil {
			t.Fatalf("%s: %v", query, err)
		}
	}
	now := time.Now().UTC()
	areaID := uuid.New()
	exec(`INSERT INTO areas (id, user_id, name, color, created_at, updated_at) VALUES ($1, $2, 'Work', '', $3, $3)`, areaID, alice.id, now)
	project := func(owner uuid.UUID, name string, area *uuid.UUID) uuid.UUID {
		id := uuid.New()
		exec(`INSERT INTO projects (id, user_id, area_id, name, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $5)`, id, owner, area, name, now)
		return id
	}
	member := func(projectID, userID uuid.UUID, role string, joined time.Time) {
		exec(`INSERT INTO project_members (project_id, user_id, role, status, created_at) VALUES ($1, $2, $3, 'active', $4)`, projectID, userID, role, joined)
	}
	shared := project(alice.id, "Shared", &areaID)
	member(shared, alice.id, "owner", now.Add(-3*time.Hour))
	member(shared, carol.id, "viewer", now.Add(-2*time.Hour))
	member(shared, bob.id, "editor", now.Add(-time.Hour))
	viewersOnly := project(alice.id, "Viewers", nil)
	member(viewersOnly, alice.id, "owner", now.Add(-3*time.Hour))
	member(viewersOnly, carol.id, "viewer", now.Add(-2*time.Hour))
	member(viewersOnly, dave.id, "viewer", now.Add(-time.Hour))
	solo := project(alice.id, "Solo", nil)
	bobs := project(bob.id, "Bob's", nil)
	member(bobs, bob.id, "owner", now.Add(-time.Hour))
	member(bobs, alice.id, "editor", now)
	exec(`INSERT INTO project_invites (project_id, inviter_user_id, invitee_email, token_hash, expires_at) VALUES ($1, $2, 'dave@delete.test', $3, $4)`, shared, alice.id, []byte("h1"), now.Add(time.Hour))
	exec(`INSERT INTO project_invites (project_id, inviter_user_id, invitee_email, token_hash, expires_at) VALUES ($1, $2, 'alice@delete.test', $3, $4)`, bobs, bob.id, []byte("h2"), now.Add(time.Hour))

	withProject := func(task tasks.Task, projectID uuid.UUID) tasks.Task {
		id := projectID.String()
		task.ProjectID = &id
		return task
	}
	personal := alice.push(alice.task())
	inShared := alice.push(withProject(alice.task(), shared))
	inBobs := alice.push(withProject(alice.task(), bobs))
	inSolo := alice.push(withProject(alice.task(), solo))
	bobTask := withProject(bob.task(), shared)
	bobTask.PeopleIDs = []string{bob.id.String(), alice.id.String()}
	bobTask = bob.push(bobTask)
	// Alice edits Bob's task: her change-log row must survive as the owner's.
	bobTask.Title = "edited by alice"
	alice.push(bobTask)
	alice.complete(personal, true)

	habit := tasks.Habit{ID: uuid.NewString(), Title: "Run", Interval: 1, Unit: "day", StartDate: now.Format(time.DateOnly), CreatedAt: now, UpdatedAt: now}
	if results, err := s.Push(ctx, alice.id, []tasks.Mutation{{ID: uuid.NewString(), Kind: "upsert", Entity: "habit", Habit: habit}}); err != nil || !results[0].OK {
		t.Fatalf("habit push: %v %+v", err, results)
	}
	exec(`INSERT INTO notes (id, user_id, title, body, created_at, updated_at) VALUES ($1, $2, 'n', 'c', $3, $3)`, uuid.New(), alice.id, now)
	if err := s.SaveNoteAttachment(ctx, alice.id, uuid.New(), "a.txt", "text/plain", []byte("x")); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateAgentChat(ctx, alice.id, "chat"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.SaveUserSettings(ctx, alice.id, "sk-or", nil, "", true); err != nil {
		t.Fatal(err)
	}
	exec(`INSERT INTO account_documents (user_id, key, value) VALUES ($1, 'preferences', '{"lang":"fr"}')`, alice.id)
	if err := s.CreateSession(ctx, alice.id, "session-token", "test", "web", time.Hour); err != nil {
		t.Fatal(err)
	}
	if err := s.CreateSession(ctx, alice.id, "mcp-token", "Claude Code", MCPTokenPlatform, time.Hour); err != nil {
		t.Fatal(err)
	}
	if err := s.SaveMailAccount(ctx, alice.id, "gmail", "alice@gmail.test", "sealed-mail", "scope"); err != nil {
		t.Fatal(err)
	}
	exec(`INSERT INTO calendar_accounts (user_id, email, refresh_token) VALUES ($1, 'alice@gmail.test', 'sealed-calendar')`, alice.id)
	exec(`INSERT INTO subscriptions (user_id, stripe_customer_id, plan, status) VALUES ($1, 'cus_1', 'pro', 'canceled')`, alice.id)
	exec(`INSERT INTO billing_payments (stripe_invoice_id, user_id, amount_cents, currency, paid_at) VALUES ('in_1', $1, 2000, 'eur', now())`, alice.id)
	exec(`INSERT INTO auth_tokens (user_id, purpose, token_hash, email, expires_at) VALUES ($1, 'email_verify', 'x', 'alice@delete.test', now() + interval '1 day')`, alice.id)
	exec(`INSERT INTO totp_recovery_codes (user_id, code_hash) VALUES ($1, 'x')`, alice.id)
	exec(`INSERT INTO auth_challenges (user_id, token_hash, expires_at) VALUES ($1, 'x', now() + interval '5 minutes')`, alice.id)
	exec(`INSERT INTO project_leaderboard_optins (project_id, user_id, joined) VALUES ($1, $2, true)`, bobs, alice.id)
	exec(`INSERT INTO kudos (from_user_id, to_user_id, task_id) VALUES ($1, $2, $3)`, alice.id, bob.id, bobTask.ID)

	deleted, err := s.DeleteAccount(ctx, alice.id)
	if err != nil {
		t.Fatal(err)
	}
	if len(deleted.SealedGoogleTokens) != 2 {
		t.Fatalf("google tokens = %v", deleted.SealedGoogleTokens)
	}
	if got := deleted.TransferredProjects[bob.id]; len(got) != 1 || got[0] != shared {
		t.Fatalf("shared project should go to the editor bob: %v", deleted.TransferredProjects)
	}
	if got := deleted.TransferredProjects[carol.id]; len(got) != 1 || got[0] != viewersOnly {
		t.Fatalf("viewer-only project should go to the oldest member carol: %v", deleted.TransferredProjects)
	}
	if len(deleted.DeletedProjects) != 1 || deleted.DeletedProjects[0] != solo {
		t.Fatalf("solo project should be deleted: %v", deleted.DeletedProjects)
	}

	var owner uuid.UUID
	var area *uuid.UUID
	if err := pool.QueryRow(ctx, `SELECT user_id, area_id FROM projects WHERE id = $1`, shared).Scan(&owner, &area); err != nil || owner != bob.id || area != nil {
		t.Fatalf("shared owner = %v area = %v err = %v", owner, area, err)
	}
	var role string
	if err := pool.QueryRow(ctx, `SELECT role FROM project_members WHERE project_id = $1 AND user_id = $2`, shared, bob.id).Scan(&role); err != nil || role != "owner" {
		t.Fatalf("bob's role = %q %v", role, err)
	}
	taskOwner := func(id string) (uuid.UUID, bool) {
		var owner uuid.UUID
		err := pool.QueryRow(ctx, `SELECT user_id FROM tasks WHERE id = $1`, id).Scan(&owner)
		return owner, err == nil
	}
	if _, ok := taskOwner(personal.ID); ok {
		t.Fatal("personal task must be deleted")
	}
	if _, ok := taskOwner(inSolo.ID); ok {
		t.Fatal("task of the deleted project must be deleted")
	}
	if got, ok := taskOwner(inShared.ID); !ok || got != bob.id {
		t.Fatalf("shared-project task should move to bob, got %v %v", got, ok)
	}
	if got, ok := taskOwner(inBobs.ID); !ok || got != bob.id {
		t.Fatalf("task in bob's project should move to bob, got %v %v", got, ok)
	}
	var people []string
	if err := pool.QueryRow(ctx, `SELECT ARRAY(SELECT jsonb_array_elements_text(people_ids)) FROM tasks WHERE id = $1`, bobTask.ID).Scan(&people); err != nil || len(people) != 1 || people[0] != bob.id.String() {
		t.Fatalf("people = %v %v", people, err)
	}
	var invites int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM project_invites WHERE invitee_email = 'alice@delete.test'`).Scan(&invites); err != nil || invites != 0 {
		t.Fatalf("invites to alice = %d %v", invites, err)
	}
	// Bob still pulls his project's tasks.
	pulled, err := s.Pull(ctx, bob.id, 0)
	if err != nil {
		t.Fatal(err)
	}
	seen := map[string]bool{}
	for _, task := range pulled.Tasks {
		seen[task.ID] = true
	}
	if !seen[inShared.ID] || !seen[bobTask.ID] || !seen[inBobs.ID] {
		t.Fatalf("bob lost shared tasks: %v", seen)
	}

	assertNoUserReferences(t, pool, alice.id)
	var payments int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM billing_payments WHERE stripe_invoice_id = 'in_1' AND user_id IS NULL`).Scan(&payments); err != nil || payments != 1 {
		t.Fatalf("payment record should be kept anonymously: %d %v", payments, err)
	}
	if _, err := s.DeleteAccount(ctx, alice.id); err != ErrNotFound {
		t.Fatalf("second delete = %v", err)
	}
}

// assertNoUserReferences scans every column holding user ids (all foreign
// keys to users, plus the people_ids lists) for the deleted account.
func assertNoUserReferences(t *testing.T, pool *pgxpool.Pool, userID uuid.UUID) {
	t.Helper()
	ctx := context.Background()
	rows, err := pool.Query(ctx, `
		SELECT cl.relname, a.attname
		FROM pg_constraint c
		JOIN pg_class cl ON cl.oid = c.conrelid
		JOIN pg_namespace n ON n.oid = cl.relnamespace
		JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
		WHERE c.contype = 'f' AND c.confrelid = to_regclass('users') AND n.nspname = current_schema()`)
	if err != nil {
		t.Fatal(err)
	}
	type column struct{ table, name string }
	var columns []column
	for rows.Next() {
		var item column
		if err := rows.Scan(&item.table, &item.name); err != nil {
			t.Fatal(err)
		}
		columns = append(columns, item)
	}
	rows.Close()
	if len(columns) < 30 {
		t.Fatalf("expected every user foreign key, found %d", len(columns))
	}
	for _, item := range columns {
		var count int
		if err := pool.QueryRow(ctx, fmt.Sprintf(`SELECT count(*) FROM %q WHERE %q = $1`, item.table, item.name), userID).Scan(&count); err != nil {
			t.Fatal(err)
		}
		if count != 0 {
			t.Errorf("%s.%s still references the deleted user (%d rows)", item.table, item.name, count)
		}
	}
	for _, table := range []string{"tasks", "task_changes"} {
		var count int
		if err := pool.QueryRow(ctx, fmt.Sprintf(`SELECT count(*) FROM %s WHERE people_ids ? $1`, table), userID.String()).Scan(&count); err != nil || count != 0 {
			t.Errorf("%s.people_ids still lists the deleted user: %d %v", table, count, err)
		}
	}
	var users int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM users WHERE id = $1`, userID).Scan(&users); err != nil || users != 0 {
		t.Errorf("user row = %d %v", users, err)
	}
}
