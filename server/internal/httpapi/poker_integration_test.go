package httpapi

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/gh-Constant/prior/server/internal/config"
	"github.com/google/uuid"
)

func TestPlanningPokerPostgres(t *testing.T) {
	srv, pool, _ := newIntegrationServer(t, config.Config{})
	call := callerFor(srv)
	ctx := context.Background()
	register := func(email string) (string, uuid.UUID) {
		code, body := call("POST", "/v1/auth/register", "", `{"email":"`+email+`","password":"correct horse","displayName":"`+strings.Split(email, "@")[0]+`"}`)
		if code != 201 {
			t.Fatalf("register %s = %d %v", email, code, body)
		}
		token := body["token"].(string)
		return token, mustUserID(t, srv, token)
	}
	alice, aliceID := register("alice@example.com") // owner
	bob, bobID := register("bob@example.com")       // editor, facilitator
	carol, _ := register("carol@example.com")       // viewer
	dave, _ := register("dave@example.com")         // outsider
	erin, erinID := register("erin@example.com")    // editor

	projectID := uuid.New()
	otherProject := uuid.New()
	now := time.Now().UTC()
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, query, args...); err != nil {
			t.Fatal(err)
		}
	}
	exec(`INSERT INTO projects (id, user_id, name, created_at, updated_at) VALUES ($1, $2, 'Sprint', $3, $3), ($4, $2, 'Other', $3, $3)`, projectID, aliceID, now, otherProject)
	exec(`INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, 'owner'), ($1, $3, 'editor'), ($1, $4, 'viewer'), ($1, $5, 'editor')`, projectID, aliceID, bobID, mustUserID(t, srv, carol), erinID)
	stamp := now.Format(time.RFC3339Nano)
	pushTask := func(token, id, title string, project uuid.UUID) {
		t.Helper()
		body := `{"mutations":[{"id":"` + uuid.NewString() + `","kind":"upsert","entity":"task","createdAt":"` + stamp + `","task":{"id":"` + id + `","title":"` + title + `","description":"","priority":4,"status":"next","projectId":"` + project.String() + `","important":false,"urgent":false,"completed":false,"createdAt":"` + stamp + `","updatedAt":"` + stamp + `","deletedAt":null}}]}`
		if code, resp := call("POST", "/v1/sync/push", token, body); code != 200 {
			t.Fatalf("push = %d %v", code, resp)
		}
	}
	t1, t2, t3, foreign := uuid.NewString(), uuid.NewString(), uuid.NewString(), uuid.NewString()
	pushTask(alice, t1, "Login page", projectID)
	pushTask(alice, t2, "Password reset", projectID)
	pushTask(alice, t3, "Profile", projectID)
	pushTask(alice, foreign, "Elsewhere", otherProject)

	base := "/v1/collaboration/projects/" + projectID.String() + "/poker"
	ids := func(list ...string) string {
		quoted := make([]string, len(list))
		for i, id := range list {
			quoted[i] = `"` + id + `"`
		}
		return "[" + strings.Join(quoted, ",") + "]"
	}
	start := ids(t1, t2, t3)

	// Access control before any session exists.
	if code, _ := call("GET", base, dave, ""); code != 404 {
		t.Fatalf("outsider read = %d", code)
	}
	if code, _ := call("GET", base, "", ""); code != 401 {
		t.Fatalf("anonymous read = %d", code)
	}
	if code, body := call("GET", base, carol, ""); code != 200 || body["session"] != nil {
		t.Fatalf("no session yet = %d %v", code, body)
	}
	if code, _ := call("POST", base, dave, `{"taskIds":`+start+`,"deck":"fibonacci"}`); code != 404 {
		t.Fatalf("outsider start = %d", code)
	}
	if code, _ := call("POST", base, carol, `{"taskIds":`+start+`,"deck":"fibonacci"}`); code != 403 {
		t.Fatalf("viewer start = %d", code)
	}
	for name, body := range map[string]string{
		"unknown deck":    `{"taskIds":` + start + `,"deck":"primes"}`,
		"no tasks":        `{"taskIds":[],"deck":"fibonacci"}`,
		"foreign task":    `{"taskIds":` + ids(t1, foreign) + `,"deck":"fibonacci"}`,
		"unknown task":    `{"taskIds":` + ids(uuid.NewString()) + `,"deck":"fibonacci"}`,
		"bad task id":     `{"taskIds":["nope"],"deck":"fibonacci"}`,
		"too many tasks":  `{"taskIds":` + ids(strings.Split(strings.TrimSuffix(strings.Repeat(t1+",", 51), ","), ",")...) + `,"deck":"fibonacci"}`,
		"unknown field":   `{"taskIds":` + start + `,"deck":"fibonacci","extra":1}`,
		"missing deck":    `{"taskIds":` + start + `}`,
		"task in project": `{"taskIds":` + ids(foreign) + `,"deck":"tshirt"}`,
	} {
		if code, _ := call("POST", base, bob, body); code != 400 {
			t.Fatalf("%s = %d", name, code)
		}
	}

	// Bob (an editor) starts the session and becomes its facilitator.
	code, session := call("POST", base, bob, `{"taskIds":`+start+`,"deck":"fibonacci"}`)
	if code != 201 {
		t.Fatalf("start = %d %v", code, session)
	}
	sessionID := session["id"].(string)
	if session["status"] != "active" || session["deck"] != "fibonacci" || session["facilitatorId"] != bobID.String() ||
		session["canControl"] != true || session["currentIndex"] != float64(0) || session["round"] != float64(1) || session["revealed"] != false {
		t.Fatalf("session = %v", session)
	}
	items := session["items"].([]any)
	if len(items) != 3 || items[0].(map[string]any)["taskId"] != t1 || items[0].(map[string]any)["title"] != "Login page" ||
		items[1].(map[string]any)["taskId"] != t2 || items[0].(map[string]any)["storyPoints"] != nil || items[0].(map[string]any)["finalPoints"] != nil {
		t.Fatalf("items = %v", items)
	}
	participants := session["participants"].([]any)
	if len(participants) != 4 || participants[0].(map[string]any)["role"] != "owner" || participants[0].(map[string]any)["userId"] != aliceID.String() {
		t.Fatalf("participants = %v", participants)
	}
	if code, _ := call("POST", base, alice, `{"taskIds":`+start+`,"deck":"fibonacci"}`); code != 409 {
		t.Fatalf("second active session = %d", code)
	}
	if code, body := call("GET", base, erin, ""); code != 200 || body["session"].(map[string]any)["id"] != sessionID || body["session"].(map[string]any)["canControl"] != false {
		t.Fatalf("active session for another editor = %d %v", code, body)
	}
	sessionPath := base + "/" + sessionID
	if code, body := call("GET", sessionPath, alice, ""); code != 200 || body["canControl"] != true {
		t.Fatalf("owner controls = %d %v", code, body)
	}
	if code, body := call("GET", sessionPath, carol, ""); code != 200 || body["canControl"] != false {
		t.Fatalf("viewer watches = %d %v", code, body)
	}
	if code, _ := call("GET", sessionPath, dave, ""); code != 404 {
		t.Fatalf("outsider session = %d", code)
	}
	if code, _ := call("GET", "/v1/collaboration/projects/"+otherProject.String()+"/poker/"+sessionID, alice, ""); code != 404 {
		t.Fatalf("session through another project = %d", code)
	}
	if code, _ := call("GET", base+"/"+uuid.NewString(), alice, ""); code != 404 {
		t.Fatalf("unknown session = %d", code)
	}

	// Voting.
	vote := func(token, task string, value string) (int, map[string]any) {
		return call("PUT", sessionPath+"/vote", token, `{"taskId":"`+task+`","value":`+value+`}`)
	}
	if code, _ := vote(carol, t1, `"5"`); code != 403 {
		t.Fatalf("viewer vote = %d", code)
	}
	if code, _ := vote(dave, t1, `"5"`); code != 404 {
		t.Fatalf("outsider vote = %d", code)
	}
	if code, _ := vote(alice, t1, `"4"`); code != 400 {
		t.Fatalf("card outside the deck = %d", code)
	}
	if code, _ := vote(alice, t1, `"M"`); code != 400 {
		t.Fatalf("t-shirt card in a fibonacci deck = %d", code)
	}
	if code, _ := vote(alice, t2, `"5"`); code != 409 {
		t.Fatalf("vote on a task that is not current = %d", code)
	}
	if code, _ := vote(alice, "bad", `"5"`); code != 400 {
		t.Fatalf("bad task id = %d", code)
	}
	if code, body := vote(alice, t1, `"5"`); code != 200 || body["myVote"] != "5" {
		t.Fatalf("alice vote = %d %v", code, body)
	}
	if code, body := vote(bob, t1, `"8"`); code != 200 || body["myVote"] != "8" {
		t.Fatalf("bob vote = %d %v", code, body)
	}
	if code, body := vote(erin, t1, `"coffee"`); code != 200 || body["myVote"] != "coffee" {
		t.Fatalf("erin vote = %d %v", code, body)
	}
	// Changing a vote and withdrawing it.
	if code, body := vote(erin, t1, `null`); code != 200 || body["myVote"] != nil {
		t.Fatalf("withdrawn vote = %d %v", code, body)
	}
	if code, body := vote(erin, t1, `"13"`); code != 200 || body["myVote"] != "13" {
		t.Fatalf("erin revote = %d %v", code, body)
	}

	// Before the reveal nobody learns another person's card.
	hidden := func(token string, own map[string]string) {
		t.Helper()
		code, body := call("GET", sessionPath, token, "")
		if code != 200 || body["revealed"] != false {
			t.Fatalf("view = %d %v", code, body)
		}
		voted := map[string]bool{}
		for _, raw := range body["participants"].([]any) {
			person := raw.(map[string]any)
			if person["vote"] != nil {
				t.Fatalf("a vote leaked before the reveal: %v", person)
			}
			voted[person["userId"].(string)], _ = person["voted"].(bool)
		}
		if !voted[aliceID.String()] || !voted[bobID.String()] || !voted[erinID.String()] || len(voted) != 4 {
			t.Fatalf("voted flags = %v", voted)
		}
		if want, ok := own[token]; ok {
			if body["myVote"] != want {
				t.Fatalf("myVote = %v want %s", body["myVote"], want)
			}
		} else if body["myVote"] != nil {
			t.Fatalf("myVote = %v", body["myVote"])
		}
		encoded, _ := json.Marshal(body)
		for _, secret := range []string{`"8"`, `"13"`, `"coffee"`} {
			if strings.Contains(string(encoded), secret) && `"`+own[token]+`"` != secret {
				t.Fatalf("the payload for %s contains another person's card %s: %s", token[:6], secret, encoded)
			}
		}
	}
	own := map[string]string{alice: "5", bob: "8", erin: "13"}
	for _, token := range []string{alice, bob, carol, erin} {
		hidden(token, own)
	}

	// Only the controller reveals.
	for name, token := range map[string]string{"viewer": carol, "other editor": erin} {
		if code, _ := call("POST", sessionPath+"/reveal", token, ""); code != 403 {
			t.Fatalf("%s reveal = %d", name, code)
		}
		if code, _ := call("POST", sessionPath+"/revote", token, ""); code != 403 {
			t.Fatalf("%s revote = %d", name, code)
		}
		if code, _ := call("POST", sessionPath+"/close", token, ""); code != 403 {
			t.Fatalf("%s close = %d", name, code)
		}
		if code, _ := call("POST", sessionPath+"/current", token, `{"index":1}`); code != 403 {
			t.Fatalf("%s current = %d", name, code)
		}
		if code, _ := call("POST", sessionPath+"/estimate", token, `{"taskId":"`+t1+`","storyPoints":5,"advance":true}`); code != 403 {
			t.Fatalf("%s estimate = %d", name, code)
		}
	}
	if code, _ := call("POST", sessionPath+"/reveal", dave, ""); code != 404 {
		t.Fatalf("outsider reveal = %d", code)
	}
	// The project owner can always take over.
	code, revealed := call("POST", sessionPath+"/reveal", alice, "")
	if code != 200 || revealed["revealed"] != true {
		t.Fatalf("owner reveal = %d %v", code, revealed)
	}
	votes := map[string]any{}
	for _, raw := range revealed["participants"].([]any) {
		person := raw.(map[string]any)
		votes[person["userId"].(string)] = person["vote"]
	}
	if votes[aliceID.String()] != "5" || votes[bobID.String()] != "8" || votes[erinID.String()] != "13" {
		t.Fatalf("revealed votes = %v", votes)
	}
	if _, seen := call("GET", sessionPath, carol, ""); func() any {
		for _, raw := range seen["participants"].([]any) {
			if person := raw.(map[string]any); person["userId"] == bobID.String() {
				return person["vote"]
			}
		}
		return nil
	}() != "8" {
		t.Fatalf("viewers see the revealed votes: %v", seen)
	}
	if code, _ := vote(alice, t1, `"3"`); code != 409 {
		t.Fatalf("vote after the reveal = %d", code)
	}

	// Re-vote starts a new round with the cards face down again.
	code, again := call("POST", sessionPath+"/revote", bob, "")
	if code != 200 || again["round"] != float64(2) || again["revealed"] != false || again["myVote"] != nil {
		t.Fatalf("revote = %d %v", code, again)
	}
	for _, raw := range again["participants"].([]any) {
		if raw.(map[string]any)["voted"] != false {
			t.Fatalf("votes survived the revote: %v", again["participants"])
		}
	}
	vote(alice, t1, `"5"`)
	vote(bob, t1, `"5"`)
	vote(erin, t1, `"5"`)
	call("POST", sessionPath+"/reveal", bob, "")

	// Estimate: the task is updated through the normal sync path.
	if code, _ := call("POST", sessionPath+"/estimate", bob, `{"taskId":"`+t2+`","storyPoints":5,"advance":true}`); code != 409 {
		t.Fatalf("estimate for a task that is not current = %d", code)
	}
	if code, _ := call("POST", sessionPath+"/estimate", bob, `{"taskId":"`+t1+`","storyPoints":0.3,"advance":true}`); code != 400 {
		t.Fatalf("estimate off the half-point grid = %d", code)
	}
	if code, _ := call("POST", sessionPath+"/estimate", bob, `{"taskId":"`+t1+`","storyPoints":1000,"advance":true}`); code != 400 {
		t.Fatalf("estimate out of range = %d", code)
	}
	code, estimated := call("POST", sessionPath+"/estimate", bob, `{"taskId":"`+t1+`","storyPoints":5,"advance":true}`)
	if code != 200 {
		t.Fatalf("estimate = %d %v", code, estimated)
	}
	after := estimated["session"].(map[string]any)
	if after["currentIndex"] != float64(1) || after["round"] != float64(1) || after["revealed"] != false {
		t.Fatalf("session did not advance: %v", after)
	}
	first := after["items"].([]any)[0].(map[string]any)
	if first["finalPoints"] != float64(5) || first["storyPoints"] != float64(5) {
		t.Fatalf("decided item = %v", first)
	}
	task := estimated["task"].(map[string]any)
	if task["id"] != t1 || task["storyPoints"] != float64(5) || task["title"] != "Login page" {
		t.Fatalf("task = %v", task)
	}
	var stored *float64
	if err := pool.QueryRow(ctx, `SELECT story_points FROM tasks WHERE id = $1`, t1).Scan(&stored); err != nil || stored == nil || *stored != 5 {
		t.Fatalf("tasks.story_points = %v %v", stored, err)
	}
	var changes int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM task_changes WHERE task_id = $1 AND story_points = 5 AND user_id = $2`, t1, bobID).Scan(&changes); err != nil || changes != 1 {
		t.Fatalf("task_changes rows for the estimate = %d %v", changes, err)
	}
	code, pulled := call("GET", "/v1/sync/pull?since=0", erin, "")
	if code != 200 {
		t.Fatalf("pull = %d", code)
	}
	pulledPoints := false
	for _, raw := range pulled["tasks"].([]any) {
		item := raw.(map[string]any)
		if item["id"] == t1 && item["storyPoints"] == float64(5) {
			pulledPoints = true
		}
	}
	if !pulledPoints {
		t.Fatalf("another member's pull lacks the estimate: %v", pulled["tasks"])
	}
	// The vote on the next task starts from a clean table.
	if code, body := vote(alice, t2, `"8"`); code != 200 || body["myVote"] != "8" {
		t.Fatalf("vote on the next task = %d %v", code, body)
	}
	if code, _ := vote(alice, t1, `"8"`); code != 409 {
		t.Fatalf("vote on the previous task = %d", code)
	}

	// Moving around: clearing an estimate keeps the position.
	if code, _ := call("POST", sessionPath+"/current", bob, `{"index":3}`); code != 400 {
		t.Fatalf("index out of range = %d", code)
	}
	if code, _ := call("POST", sessionPath+"/current", bob, `{"index":-1}`); code != 400 {
		t.Fatalf("negative index = %d", code)
	}
	if code, _ := call("POST", sessionPath+"/current", bob, `{}`); code != 400 {
		t.Fatalf("missing index = %d", code)
	}
	code, moved := call("POST", sessionPath+"/current", bob, `{"index":0}`)
	if code != 200 || moved["currentIndex"] != float64(0) || moved["revealed"] != false {
		t.Fatalf("current = %d %v", code, moved)
	}
	code, cleared := call("POST", sessionPath+"/estimate", bob, `{"taskId":"`+t1+`","storyPoints":null,"advance":false}`)
	if code != 200 || cleared["task"].(map[string]any)["storyPoints"] != nil || cleared["session"].(map[string]any)["currentIndex"] != float64(0) {
		t.Fatalf("clearing the estimate = %d %v", code, cleared)
	}
	if err := pool.QueryRow(ctx, `SELECT story_points FROM tasks WHERE id = $1`, t1).Scan(&stored); err != nil || stored != nil {
		t.Fatalf("cleared story_points = %v %v", stored, err)
	}

	// A task that vanishes from the project leaves the table.
	exec(`UPDATE tasks SET deleted_at = now() WHERE id = $1`, t3)
	if _, body := call("GET", sessionPath, alice, ""); len(body["items"].([]any)) != 2 {
		t.Fatalf("deleted tasks must not be listed: %v", body["items"])
	}
	exec(`UPDATE tasks SET project_id = $2 WHERE id = $1`, t2, otherProject)
	if _, body := call("GET", sessionPath, alice, ""); len(body["items"].([]any)) != 1 {
		t.Fatalf("moved tasks must not be listed: %v", body["items"])
	}
	exec(`UPDATE tasks SET project_id = $2, deleted_at = NULL WHERE id = $1`, t2, projectID)
	exec(`UPDATE tasks SET deleted_at = NULL WHERE id = $1`, t3)

	// Closing ends the session; a new one can start.
	if code, body := call("POST", sessionPath+"/close", bob, ""); code != 200 || body["status"] != "closed" {
		t.Fatalf("close = %d %v", code, body)
	}
	if code, _ := call("POST", sessionPath+"/close", bob, ""); code != 200 {
		t.Fatalf("closing twice = %d", code)
	}
	if code, _ := vote(alice, t1, `"5"`); code != 409 {
		t.Fatalf("vote in a closed session = %d", code)
	}
	if code, _ := call("POST", sessionPath+"/reveal", alice, ""); code != 409 {
		t.Fatalf("reveal in a closed session = %d", code)
	}
	if code, _ := call("POST", sessionPath+"/estimate", alice, `{"taskId":"`+t1+`","storyPoints":3,"advance":true}`); code != 409 {
		t.Fatalf("estimate in a closed session = %d", code)
	}
	if code, body := call("GET", base, alice, ""); code != 200 || body["session"] != nil {
		t.Fatalf("active after close = %d %v", code, body)
	}
	if code, body := call("GET", sessionPath, alice, ""); code != 200 || body["status"] != "closed" {
		t.Fatalf("closed session stays readable = %d %v", code, body)
	}

	// The t-shirt deck has its own cards; the facilitator may be gone.
	code, shirts := call("POST", base, alice, `{"taskIds":`+ids(t1, t2)+`,"deck":"tshirt"}`)
	if code != 201 {
		t.Fatalf("t-shirt session = %d %v", code, shirts)
	}
	shirtPath := base + "/" + shirts["id"].(string)
	if code, _ := call("PUT", shirtPath+"/vote", bob, `{"taskId":"`+t1+`","value":"5"}`); code != 400 {
		t.Fatalf("number in a t-shirt deck = %d", code)
	}
	if code, body := call("PUT", shirtPath+"/vote", bob, `{"taskId":"`+t1+`","value":"XL"}`); code != 200 || body["myVote"] != "XL" {
		t.Fatalf("t-shirt vote = %d %v", code, body)
	}
	exec(`UPDATE poker_sessions SET facilitator_id = NULL WHERE id = $1`, shirts["id"])
	if code, body := call("GET", shirtPath, erin, ""); code != 200 || body["canControl"] != true || body["facilitatorId"] != nil {
		t.Fatalf("any editor controls without a facilitator = %d %v", code, body)
	}
	if code, body := call("GET", shirtPath, carol, ""); code != 200 || body["canControl"] != false {
		t.Fatalf("viewers never control = %d %v", code, body)
	}
	code, estimated = call("POST", shirtPath+"/estimate", erin, `{"taskId":"`+t1+`","storyPoints":8,"advance":true}`)
	if code != 200 || estimated["task"].(map[string]any)["storyPoints"] != float64(8) {
		t.Fatalf("t-shirt estimate = %d %v", code, estimated)
	}

	// Idle sessions are closed, old closed ones deleted.
	exec(`UPDATE poker_sessions SET updated_at = now() - interval '13 hours' WHERE id = $1`, shirts["id"])
	closed, deleted, err := srv.store.ExpirePokerSessions(ctx)
	if err != nil || closed != 1 || deleted != 0 {
		t.Fatalf("expire = %d %d %v", closed, deleted, err)
	}
	if code, body := call("GET", base, alice, ""); code != 200 || body["session"] != nil {
		t.Fatalf("expired session still active = %d %v", code, body)
	}
	exec(`UPDATE poker_sessions SET closed_at = now() - interval '31 days'`)
	if _, deleted, err = srv.store.ExpirePokerSessions(ctx); err != nil || deleted != 2 {
		t.Fatalf("expire deletes old sessions: %d %v", deleted, err)
	}
	var left int
	if err := pool.QueryRow(ctx, `SELECT (SELECT count(*) FROM poker_sessions) + (SELECT count(*) FROM poker_items) + (SELECT count(*) FROM poker_votes)`).Scan(&left); err != nil || left != 0 {
		t.Fatalf("rows left after the cleanup = %d %v", left, err)
	}
}
