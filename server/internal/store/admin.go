package store

import (
	"context"
	"strings"
	"time"

	"github.com/google/uuid"
)

// AdminOverview is the data behind the admin dashboard.
type AdminOverview struct {
	GeneratedAt time.Time       `json:"generatedAt"`
	Totals      AdminTotals     `json:"totals"`
	PlanCounts  map[string]int  `json:"planCounts"`
	Signups     []AdminDayCount `json:"signups"`
	ActiveDaily []AdminDayCount `json:"activeDaily"`
	Revenue     []AdminMonthSum `json:"revenue"`
	AICost      []AdminDayCost  `json:"aiCost"`
	AIByPurpose []AdminPurpose  `json:"aiByPurpose"`
	TopSpenders []AdminSpender  `json:"topSpenders"`
	Payments    []AdminPayment  `json:"recentPayments"`
}

type AdminTotals struct {
	Users           int   `json:"users"`
	NewUsers7d      int   `json:"newUsers7d"`
	NewUsers30d     int   `json:"newUsers30d"`
	ActiveUsers7d   int   `json:"activeUsers7d"`
	PayingUsers     int   `json:"payingUsers"`
	GrantedUsers    int   `json:"grantedUsers"`
	CancelingUsers  int   `json:"cancelingUsers"`
	MRRCents        int64 `json:"mrrCents"`
	Revenue30dCents int64 `json:"revenue30dCents"`
	RevenueAllCents int64 `json:"revenueAllCents"`
	AICost30dMicros int64 `json:"aiCost30dMicros"`
	AICostAllMicros int64 `json:"aiCostAllMicros"`
	AIRequests30d   int64 `json:"aiRequests30d"`
	AITokens30d     int64 `json:"aiTokens30d"`
	AIUsers30d      int   `json:"aiUsers30d"`
	SharedProjects  int   `json:"sharedProjects"`
	TasksCreated30d int   `json:"tasksCreated30d"`
}

type AdminDayCount struct {
	Day   string `json:"day"`
	Count int    `json:"count"`
}

type AdminMonthSum struct {
	Month string `json:"month"`
	Cents int64  `json:"cents"`
}

type AdminDayCost struct {
	Day    string `json:"day"`
	Micros int64  `json:"micros"`
	Tokens int64  `json:"tokens"`
}

type AdminPurpose struct {
	Purpose  string `json:"purpose"`
	Requests int64  `json:"requests"`
	Tokens   int64  `json:"tokens"`
	Micros   int64  `json:"micros"`
}

type AdminSpender struct {
	UserID      uuid.UUID `json:"userId"`
	Email       string    `json:"email"`
	DisplayName string    `json:"displayName"`
	Plan        string    `json:"plan"`
	Micros      int64     `json:"micros"`
	Tokens      int64     `json:"tokens"`
	Requests    int64     `json:"requests"`
}

type AdminPayment struct {
	InvoiceID   string    `json:"invoiceId"`
	Email       string    `json:"email"`
	AmountCents int64     `json:"amountCents"`
	Currency    string    `json:"currency"`
	PaidAt      time.Time `json:"paidAt"`
}

// AdminOverview aggregates users, plans, revenue and Prior AI spending.
func (s *Store) AdminOverview(ctx context.Context) (AdminOverview, error) {
	out := AdminOverview{GeneratedAt: time.Now().UTC(), PlanCounts: map[string]int{"free": 0, "pro": 0, "team": 0, "enterprise": 0}}
	t := &out.Totals
	err := s.pool.QueryRow(ctx, `
		SELECT
			(SELECT count(*) FROM users),
			(SELECT count(*) FROM users WHERE created_at >= now() - interval '7 days'),
			(SELECT count(*) FROM users WHERE created_at >= now() - interval '30 days'),
			(SELECT count(DISTINCT user_id) FROM sessions WHERE last_used_at >= now() - interval '7 days'),
			(SELECT count(*) FROM subscriptions WHERE stripe_subscription_id IS NOT NULL AND status IN ('active', 'trialing', 'past_due') AND amount_cents > 0),
			(SELECT count(*) FROM subscriptions WHERE admin_plan IS NOT NULL AND admin_plan <> 'free'),
			(SELECT count(*) FROM subscriptions WHERE stripe_subscription_id IS NOT NULL AND status IN ('active', 'trialing', 'past_due') AND cancel_at_period_end),
			(SELECT COALESCE(SUM(CASE WHEN billing_interval = 'year' THEN amount_cents / 12 ELSE amount_cents END), 0)::bigint
				FROM subscriptions WHERE stripe_subscription_id IS NOT NULL AND status IN ('active', 'trialing', 'past_due')),
			(SELECT COALESCE(SUM(amount_cents), 0)::bigint FROM billing_payments WHERE paid_at >= now() - interval '30 days'),
			(SELECT COALESCE(SUM(amount_cents), 0)::bigint FROM billing_payments),
			(SELECT COALESCE(SUM(cost_micros), 0)::bigint FROM hosted_ai_usage WHERE day >= current_date - 29),
			(SELECT COALESCE(SUM(cost_micros), 0)::bigint FROM hosted_ai_usage),
			(SELECT COALESCE(SUM(requests), 0)::bigint FROM hosted_ai_usage WHERE day >= current_date - 29),
			(SELECT COALESCE(SUM(tokens), 0)::bigint FROM hosted_ai_usage WHERE day >= current_date - 29),
			(SELECT count(DISTINCT user_id) FROM hosted_ai_usage WHERE day >= current_date - 29),
			(SELECT count(DISTINCT project_id) FROM project_members WHERE status = 'active' AND role <> 'owner'),
			(SELECT count(*) FROM tasks WHERE created_at >= now() - interval '30 days')`).
		Scan(&t.Users, &t.NewUsers7d, &t.NewUsers30d, &t.ActiveUsers7d, &t.PayingUsers, &t.GrantedUsers, &t.CancelingUsers, &t.MRRCents,
			&t.Revenue30dCents, &t.RevenueAllCents, &t.AICost30dMicros, &t.AICostAllMicros, &t.AIRequests30d, &t.AITokens30d, &t.AIUsers30d,
			&t.SharedProjects, &t.TasksCreated30d)
	if err != nil {
		return out, err
	}

	rows, err := s.pool.Query(ctx, `SELECT `+effectivePlanSQL+` AS plan, count(*) FROM users u LEFT JOIN subscriptions sub ON sub.user_id = u.id GROUP BY 1`)
	if err != nil {
		return out, err
	}
	for rows.Next() {
		var plan string
		var count int
		if err := rows.Scan(&plan, &count); err != nil {
			rows.Close()
			return out, err
		}
		out.PlanCounts[plan] = count
	}
	rows.Close()

	if out.Signups, err = s.dayCounts(ctx, `SELECT created_at::date AS day, count(*) FROM users WHERE created_at >= current_date - 29 GROUP BY 1`); err != nil {
		return out, err
	}
	if out.ActiveDaily, err = s.dayCounts(ctx, `SELECT day, count(DISTINCT user_id) FROM (
			SELECT last_used_at::date AS day, user_id FROM sessions WHERE last_used_at >= current_date - 29
			UNION ALL SELECT day, user_id FROM hosted_ai_usage WHERE day >= current_date - 29) activity GROUP BY 1`); err != nil {
		return out, err
	}

	rows, err = s.pool.Query(ctx, `
		SELECT to_char(month, 'YYYY-MM'), COALESCE(SUM(p.amount_cents), 0)::bigint
		FROM generate_series(date_trunc('month', now()) - interval '11 months', date_trunc('month', now()), interval '1 month') AS month
		LEFT JOIN billing_payments p ON date_trunc('month', p.paid_at) = month
		GROUP BY month ORDER BY month`)
	if err != nil {
		return out, err
	}
	for rows.Next() {
		var entry AdminMonthSum
		if err := rows.Scan(&entry.Month, &entry.Cents); err != nil {
			rows.Close()
			return out, err
		}
		out.Revenue = append(out.Revenue, entry)
	}
	rows.Close()

	rows, err = s.pool.Query(ctx, `
		SELECT to_char(d, 'YYYY-MM-DD'), COALESCE(SUM(h.cost_micros), 0)::bigint, COALESCE(SUM(h.tokens), 0)::bigint
		FROM generate_series(current_date - 29, current_date, interval '1 day') AS d
		LEFT JOIN hosted_ai_usage h ON h.day = d::date
		GROUP BY d ORDER BY d`)
	if err != nil {
		return out, err
	}
	for rows.Next() {
		var entry AdminDayCost
		if err := rows.Scan(&entry.Day, &entry.Micros, &entry.Tokens); err != nil {
			rows.Close()
			return out, err
		}
		out.AICost = append(out.AICost, entry)
	}
	rows.Close()

	rows, err = s.pool.Query(ctx, `
		SELECT purpose, SUM(requests)::bigint, SUM(tokens)::bigint, SUM(cost_micros)::bigint
		FROM hosted_ai_usage WHERE day >= current_date - 29 GROUP BY purpose ORDER BY 4 DESC, 2 DESC`)
	if err != nil {
		return out, err
	}
	for rows.Next() {
		var entry AdminPurpose
		if err := rows.Scan(&entry.Purpose, &entry.Requests, &entry.Tokens, &entry.Micros); err != nil {
			rows.Close()
			return out, err
		}
		out.AIByPurpose = append(out.AIByPurpose, entry)
	}
	rows.Close()

	rows, err = s.pool.Query(ctx, `
		SELECT u.id, u.email, u.display_name, `+effectivePlanSQL+`,
			SUM(h.cost_micros)::bigint, SUM(h.tokens)::bigint, SUM(h.requests)::bigint
		FROM hosted_ai_usage h
		JOIN users u ON u.id = h.user_id
		LEFT JOIN subscriptions sub ON sub.user_id = u.id
		WHERE h.day >= current_date - 29
		GROUP BY u.id, u.email, u.display_name, sub.admin_plan, sub.stripe_subscription_id, sub.status, sub.plan
		ORDER BY 5 DESC, 6 DESC LIMIT 8`)
	if err != nil {
		return out, err
	}
	for rows.Next() {
		var entry AdminSpender
		if err := rows.Scan(&entry.UserID, &entry.Email, &entry.DisplayName, &entry.Plan, &entry.Micros, &entry.Tokens, &entry.Requests); err != nil {
			rows.Close()
			return out, err
		}
		out.TopSpenders = append(out.TopSpenders, entry)
	}
	rows.Close()

	rows, err = s.pool.Query(ctx, `
		SELECT p.stripe_invoice_id, COALESCE(u.email, ''), p.amount_cents, p.currency, p.paid_at
		FROM billing_payments p LEFT JOIN users u ON u.id = p.user_id
		ORDER BY p.paid_at DESC LIMIT 8`)
	if err != nil {
		return out, err
	}
	for rows.Next() {
		var entry AdminPayment
		if err := rows.Scan(&entry.InvoiceID, &entry.Email, &entry.AmountCents, &entry.Currency, &entry.PaidAt); err != nil {
			rows.Close()
			return out, err
		}
		out.Payments = append(out.Payments, entry)
	}
	rows.Close()
	return out, rows.Err()
}

// dayCounts fills the last 30 days (oldest first) from a (day, count) query.
func (s *Store) dayCounts(ctx context.Context, query string) ([]AdminDayCount, error) {
	rows, err := s.pool.Query(ctx, `
		WITH counts AS (`+query+`)
		SELECT to_char(d, 'YYYY-MM-DD'), COALESCE(c.count, 0)::int
		FROM generate_series(current_date - 29, current_date, interval '1 day') AS d
		LEFT JOIN counts c ON c.day = d::date
		ORDER BY d`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []AdminDayCount
	for rows.Next() {
		var entry AdminDayCount
		if err := rows.Scan(&entry.Day, &entry.Count); err != nil {
			return nil, err
		}
		out = append(out, entry)
	}
	return out, rows.Err()
}

// AdminUser is one row of the admin user list.
type AdminUser struct {
	ID                uuid.UUID  `json:"id"`
	Email             string     `json:"email"`
	DisplayName       string     `json:"displayName"`
	AvatarURL         string     `json:"avatarUrl,omitempty"`
	CreatedAt         time.Time  `json:"createdAt"`
	LastLoginAt       time.Time  `json:"lastLoginAt"`
	Plan              string     `json:"plan"`
	Source            string     `json:"source"`
	StripeStatus      string     `json:"stripeStatus"`
	Interval          string     `json:"interval,omitempty"`
	AmountCents       int64      `json:"amountCents"`
	CurrentPeriodEnd  *time.Time `json:"currentPeriodEnd,omitempty"`
	CancelAtPeriodEnd bool       `json:"cancelAtPeriodEnd"`
	AdminPlan         *string    `json:"adminPlan,omitempty"`
	RevenueCents      int64      `json:"revenueCents"`
	AICost30dMicros   int64      `json:"aiCost30dMicros"`
	AgentTokensMonth  int64      `json:"agentTokensMonth"`
	AIRequests30d     int64      `json:"aiRequests30d"`
	Tasks             int64      `json:"tasks"`
	SharedProjects    int64      `json:"sharedProjects"`
}

type AdminUserQuery struct {
	Search string
	Plan   string
	Sort   string
	Limit  int
	Offset int
}

// AdminUsers lists accounts with their plan and usage, newest first by
// default. It returns the page and the total matching count.
func (s *Store) AdminUsers(ctx context.Context, query AdminUserQuery) ([]AdminUser, int, error) {
	if query.Limit <= 0 || query.Limit > 200 {
		query.Limit = 50
	}
	if query.Offset < 0 {
		query.Offset = 0
	}
	order := "u.created_at DESC"
	switch query.Sort {
	case "active":
		order = "u.last_login_at DESC"
	case "spend":
		order = "ai_cost DESC, u.created_at DESC"
	case "revenue":
		order = "revenue DESC, u.created_at DESC"
	}
	search := "%" + strings.ToLower(strings.TrimSpace(query.Search)) + "%"
	plan := strings.TrimSpace(query.Plan)
	rows, err := s.pool.Query(ctx, `
		WITH base AS (
			SELECT u.id, u.email, u.display_name, u.avatar_url, u.created_at, u.last_login_at,
				`+effectivePlanSQL+` AS plan,
				CASE WHEN sub.admin_plan IS NOT NULL THEN 'admin'
					WHEN sub.stripe_subscription_id IS NOT NULL AND sub.status IN ('active', 'trialing', 'past_due') THEN 'stripe'
					ELSE 'free' END AS source,
				COALESCE(sub.status, 'none') AS status, COALESCE(sub.billing_interval, '') AS billing_interval,
				COALESCE(sub.amount_cents, 0) AS amount_cents, sub.current_period_end, COALESCE(sub.cancel_at_period_end, false) AS cancel_at_period_end,
				sub.admin_plan,
				COALESCE((SELECT SUM(amount_cents) FROM billing_payments p WHERE p.user_id = u.id), 0)::bigint AS revenue,
				COALESCE((SELECT SUM(cost_micros) FROM hosted_ai_usage h WHERE h.user_id = u.id AND h.day >= current_date - 29), 0)::bigint AS ai_cost,
				COALESCE((SELECT SUM(tokens) FROM hosted_ai_usage h WHERE h.user_id = u.id AND h.purpose = 'agent' AND h.day >= date_trunc('month', current_date)::date), 0)::bigint AS agent_tokens,
				COALESCE((SELECT SUM(requests) FROM hosted_ai_usage h WHERE h.user_id = u.id AND h.day >= current_date - 29), 0)::bigint AS ai_requests,
				(SELECT count(*) FROM tasks t WHERE t.user_id = u.id AND t.deleted_at IS NULL) AS task_count,
				(SELECT count(DISTINCT m.project_id) FROM project_members m JOIN projects p ON p.id = m.project_id
					WHERE p.user_id = u.id AND m.status = 'active' AND m.user_id <> u.id) AS shared_projects
			FROM users u LEFT JOIN subscriptions sub ON sub.user_id = u.id
			WHERE (lower(u.email) LIKE $1 OR lower(u.display_name) LIKE $1)
		)
		SELECT *, count(*) OVER () FROM base u
		WHERE $2 = '' OR u.plan = $2
		ORDER BY `+order+`
		LIMIT $3 OFFSET $4`, search, plan, query.Limit, query.Offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	var users []AdminUser
	total := 0
	for rows.Next() {
		var user AdminUser
		if err := rows.Scan(&user.ID, &user.Email, &user.DisplayName, &user.AvatarURL, &user.CreatedAt, &user.LastLoginAt,
			&user.Plan, &user.Source, &user.StripeStatus, &user.Interval, &user.AmountCents, &user.CurrentPeriodEnd, &user.CancelAtPeriodEnd,
			&user.AdminPlan, &user.RevenueCents, &user.AICost30dMicros, &user.AgentTokensMonth, &user.AIRequests30d, &user.Tasks, &user.SharedProjects, &total); err != nil {
			return nil, 0, err
		}
		users = append(users, user)
	}
	return users, total, rows.Err()
}
