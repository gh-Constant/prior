import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type AdminOverview, type AdminUser, type BillingPlan, type PlanId } from "../../lib/api";
import { getToken } from "../../lib/auth";
import { formatMoney, formatTokens, PLAN_ORDER } from "../../lib/billing";
import { useI18n } from "../../lib/i18n";
import { Icon, type IconName } from "../Icon";
import { AreaChart, BarList, ColumnChart } from "./AdminCharts";
import { ShaderCanvas } from "./ShaderCanvas";
import "./AdminView.css";

const PAGE_SIZE = 25;

type OverviewResponse = { overview: AdminOverview; plans: BillingPlan[]; stripeMode: string; hostedAIReady: boolean };

function usd(micros: number, lang: string): string {
  const amount = micros / 1_000_000;
  return new Intl.NumberFormat(lang, { style: "currency", currency: "USD", minimumFractionDigits: amount > 0 && amount < 10 ? 2 : 0, maximumFractionDigits: 2 }).format(amount);
}

function compact(value: number, lang: string): string {
  return new Intl.NumberFormat(lang, { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function relative(value: string, lang: string): string {
  const diff = (new Date(value).getTime() - Date.now()) / 1000;
  const format = new Intl.RelativeTimeFormat(lang, { numeric: "auto" });
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [["year", 31_536_000], ["month", 2_592_000], ["day", 86_400], ["hour", 3_600], ["minute", 60]];
  for (const [unit, seconds] of units) {
    if (Math.abs(diff) >= seconds) return format.format(Math.round(diff / seconds), unit);
  }
  return format.format(0, "minute");
}

function dayLabel(day: string, lang: string): string {
  return new Intl.DateTimeFormat(lang, { day: "numeric", month: "short" }).format(new Date(`${day}T00:00:00Z`));
}

function monthLabel(month: string, lang: string): string {
  return new Intl.DateTimeFormat(lang, { month: "short", year: "2-digit" }).format(new Date(`${month}-01T00:00:00Z`));
}

export function AdminView() {
  const { t, lang } = useI18n();
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "forbidden" | "error">("loading");
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const token = await getToken();
      if (!token) {
        setStatus("forbidden");
        return;
      }
      setData(await api.adminOverview(token));
      setStatus("ready");
    } catch (error) {
      setStatus(error instanceof Error && /admin access/i.test(error.message) ? "forbidden" : "error");
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (status === "forbidden") return <section className="admin-page"><p className="admin-empty-state">{t("billing.admin.forbidden")}</p></section>;

  const overview = data?.overview;
  const totals = overview?.totals;
  const eur = (cents: number) => formatMoney(cents, lang, "eur");

  return (
    <section className="admin-page" aria-labelledby="admin-title">
      <header className="admin-hero">
        <div className="admin-hero-field" aria-hidden="true"><ShaderCanvas variant="night" /></div>
        <div className="admin-hero-copy">
          <span className="admin-eyebrow">{t("billing.admin.subtitle")}</span>
          <h1 id="admin-title">{t("billing.admin.title")}</h1>
          <div className="admin-pills">
            {data && <span className={`admin-pill ${data.stripeMode === "live" ? "is-live" : ""}`}><Icon name="credit-card" />{data.stripeMode === "live" ? t("billing.admin.stripeLive") : data.stripeMode === "test" ? t("billing.admin.stripeTest") : t("billing.admin.stripeOff")}</span>}
            {data && !data.hostedAIReady && <span className="admin-pill is-warning"><Icon name="sparkles" />{t("billing.admin.aiOff")}</span>}
            {overview && <span className="admin-pill is-quiet">{t("billing.admin.updated", { time: relative(overview.generatedAt, lang) })}</span>}
          </div>
        </div>
        <button type="button" className="admin-refresh" onClick={() => void load()} disabled={refreshing} aria-busy={refreshing}>
          <Icon name="refresh" />
          <span>{t("billing.admin.refresh")}</span>
        </button>
      </header>

      {status === "error" && <p className="admin-error" role="alert">{t("billing.admin.loadError")}</p>}

      {totals && overview && (
        <>
          <div className="admin-kpis">
            <Kpi icon="user" label={t("billing.admin.kpi.users")} value={compact(totals.users, lang)} detail={t("billing.admin.kpi.usersNew", { count: totals.newUsers7d })} />
            <Kpi icon="activity" label={t("billing.admin.kpi.active")} value={compact(totals.activeUsers7d, lang)} detail={t("billing.admin.kpi.activeShare", { percent: totals.users ? Math.round((totals.activeUsers7d / totals.users) * 100) : 0 })} />
            <Kpi icon="award" label={t("billing.admin.kpi.paying")} value={compact(totals.payingUsers, lang)} detail={t("billing.admin.kpi.payingDetail", { canceling: totals.cancelingUsers, granted: totals.grantedUsers })} />
            <Kpi icon="trending-up" label={t("billing.admin.kpi.mrr")} value={eur(totals.mrrCents)} detail={t("billing.admin.kpi.arr", { amount: eur(totals.mrrCents * 12) })} accent />
            <Kpi icon="dollar-sign" label={t("billing.admin.kpi.revenue")} value={eur(totals.revenue30dCents)} detail={t("billing.admin.kpi.revenueAll", { amount: eur(totals.revenueAllCents) })} />
            <Kpi icon="cpu" label={t("billing.admin.kpi.aiCost")} value={usd(totals.aiCost30dMicros, lang)} detail={t("billing.admin.charts.requests", { count: compact(totals.aiRequests30d, lang) })} />
          </div>

          <div className="admin-grid">
            <Card title={t("billing.admin.charts.signups")} caption={t("billing.admin.charts.last30")}>
              <ColumnChart ariaLabel={t("billing.admin.charts.signups")} points={overview.signups.map((entry) => ({ label: entry.day, value: entry.count }))} format={(value) => compact(value, lang)} formatLabel={(day) => dayLabel(day, lang)} />
            </Card>
            <Card title={t("billing.admin.charts.active")} caption={t("billing.admin.charts.last30")}>
              <AreaChart ariaLabel={t("billing.admin.charts.active")} points={overview.activeDaily.map((entry) => ({ label: entry.day, value: entry.count }))} format={(value) => compact(value, lang)} formatLabel={(day) => dayLabel(day, lang)} />
            </Card>
            <Card title={t("billing.admin.charts.revenue")} caption={t("billing.admin.charts.last12")}>
              <ColumnChart ariaLabel={t("billing.admin.charts.revenue")} points={overview.revenue.map((entry) => ({ label: entry.month, value: entry.cents }))} format={eur} formatLabel={(month) => monthLabel(month, lang)} />
            </Card>
            <Card title={t("billing.admin.charts.aiCost")} caption={t("billing.admin.charts.last30")}>
              <AreaChart ariaLabel={t("billing.admin.charts.aiCost")} points={overview.aiCost.map((entry) => ({ label: entry.day, value: entry.micros }))} format={(value) => usd(value, lang)} formatLabel={(day) => dayLabel(day, lang)} />
            </Card>
          </div>

          <div className="admin-grid is-three">
            <Card title={t("billing.admin.charts.plans")}>
              <BarList
                format={(value) => compact(value, lang)}
                rows={PLAN_ORDER.map((plan) => ({ key: plan, label: t(`billing.plans.${plan}.name`), value: overview.planCounts[plan] ?? 0 }))}
              />
            </Card>
            <Card title={t("billing.admin.charts.purposes")} caption={t("billing.admin.charts.last30")}>
              {overview.aiByPurpose?.length ? (
                <BarList
                  format={(value) => usd(value, lang)}
                  rows={overview.aiByPurpose.map((entry) => ({
                    key: entry.purpose,
                    label: t(`billing.admin.purposes.${entry.purpose}`),
                    value: entry.micros,
                    detail: `${t("billing.admin.charts.requests", { count: compact(entry.requests, lang) })} · ${t("billing.admin.charts.tokens", { count: formatTokens(entry.tokens, lang) })}`,
                  }))}
                />
              ) : <p className="admin-empty">{t("billing.admin.charts.empty")}</p>}
            </Card>
            <Card title={t("billing.admin.charts.spenders")} caption={t("billing.admin.charts.last30")}>
              {overview.topSpenders?.length ? (
                <ol className="admin-rank">
                  {overview.topSpenders.map((spender) => (
                    <li key={spender.userId}>
                      <span className="admin-avatar" aria-hidden="true">{(spender.displayName || spender.email)[0]?.toUpperCase()}</span>
                      <span className="admin-rank-who"><strong>{spender.displayName || spender.email}</strong><small>{spender.email} · {t(`billing.plans.${spender.plan}.name`)}</small></span>
                      <span className="admin-rank-value"><strong>{usd(spender.micros, lang)}</strong><small>{t("billing.admin.charts.tokens", { count: formatTokens(spender.tokens, lang) })}</small></span>
                    </li>
                  ))}
                </ol>
              ) : <p className="admin-empty">{t("billing.admin.charts.empty")}</p>}
            </Card>
          </div>

          <Card title={t("billing.admin.charts.payments")}>
            {overview.recentPayments?.length ? (
              <ul className="admin-payments">
                {overview.recentPayments.map((payment) => (
                  <li key={payment.invoiceId}>
                    <Icon name="check-circle" />
                    <span>{payment.email || "—"}</span>
                    <small>{relative(payment.paidAt, lang)}</small>
                    <strong>{formatMoney(payment.amountCents, lang, payment.currency)}</strong>
                  </li>
                ))}
              </ul>
            ) : <p className="admin-empty">{t("billing.admin.charts.empty")}</p>}
          </Card>

          <UsersTable plans={data?.plans ?? []} onChanged={() => void load()} />
        </>
      )}
    </section>
  );
}

function Kpi({ icon, label, value, detail, accent }: { readonly icon: IconName; readonly label: string; readonly value: string; readonly detail: string; readonly accent?: boolean }) {
  return (
    <div className={`admin-kpi ${accent ? "is-accent" : ""}`}>
      <span className="admin-kpi-icon" aria-hidden="true"><Icon name={icon} /></span>
      <span className="admin-kpi-label">{label}</span>
      <strong className="admin-kpi-value">{value}</strong>
      <span className="admin-kpi-detail">{detail}</span>
    </div>
  );
}

function Card({ title, caption, children }: { readonly title: string; readonly caption?: string; readonly children: React.ReactNode }) {
  return (
    <section className="admin-card">
      <header><h2>{title}</h2>{caption && <span>{caption}</span>}</header>
      {children}
    </section>
  );
}

function UsersTable({ plans, onChanged }: { readonly plans: readonly BillingPlan[]; readonly onChanged: () => void }) {
  const { t, lang } = useI18n();
  const [query, setQuery] = useState("");
  const [plan, setPlan] = useState<"" | PlanId>("");
  const [sort, setSort] = useState("newest");
  const [page, setPage] = useState(0);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const load = useCallback(async () => {
    const token = await getToken();
    if (!token) return;
    const result = await api.adminUsers({ q: query.trim(), plan, sort, limit: PAGE_SIZE, offset: page * PAGE_SIZE }, token);
    setUsers(result.users);
    setTotal(result.total);
  }, [query, plan, sort, page]);

  useEffect(() => {
    const handle = window.setTimeout(() => { void load().catch(() => undefined); }, 200);
    return () => window.clearTimeout(handle);
  }, [load]);

  const planOptions = useMemo(() => (plans.length ? plans.map((entry) => entry.id) : [...PLAN_ORDER]), [plans]);

  async function give(user: AdminUser, next: "" | PlanId) {
    const token = await getToken();
    if (!token) return;
    setSaving(user.id);
    try {
      await api.adminSetPlan(user.id, next, token);
      setSaved(user.id);
      window.setTimeout(() => setSaved((current) => (current === user.id ? null : current)), 1800);
      await load();
      onChanged();
    } finally {
      setSaving(null);
    }
  }

  const from = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const to = Math.min(total, (page + 1) * PAGE_SIZE);

  return (
    <section className="admin-card admin-users" aria-labelledby="admin-users-title">
      <header>
        <h2 id="admin-users-title">{t("billing.admin.users.title")}</h2>
        <span>{t("billing.admin.users.showing", { from, to, total })}</span>
      </header>
      <div className="admin-filters">
        <label className="admin-search">
          <Icon name="search" />
          <input type="search" value={query} placeholder={t("billing.admin.users.search")} aria-label={t("billing.admin.users.search")} onChange={(event) => { setQuery(event.target.value); setPage(0); }} />
        </label>
        <select value={plan} aria-label={t("billing.admin.users.plan")} onChange={(event) => { setPlan(event.target.value as "" | PlanId); setPage(0); }}>
          <option value="">{t("billing.admin.users.allPlans")}</option>
          {planOptions.map((id) => <option key={id} value={id}>{t(`billing.plans.${id}.name`)}</option>)}
        </select>
        <select value={sort} aria-label="Sort" onChange={(event) => { setSort(event.target.value); setPage(0); }}>
          <option value="newest">{t("billing.admin.users.sortNewest")}</option>
          <option value="active">{t("billing.admin.users.sortActive")}</option>
          <option value="spend">{t("billing.admin.users.sortSpend")}</option>
          <option value="revenue">{t("billing.admin.users.sortRevenue")}</option>
        </select>
      </div>
      <div className="admin-table-scroll">
        <table className="admin-table">
          <thead>
            <tr>
              <th scope="col">{t("billing.admin.users.user")}</th>
              <th scope="col">{t("billing.admin.users.plan")}</th>
              <th scope="col" className="is-num">{t("billing.admin.users.revenue")}</th>
              <th scope="col" className="is-num">{t("billing.admin.users.aiCost")}</th>
              <th scope="col" className="is-num">{t("billing.admin.users.tokens")}</th>
              <th scope="col">{t("billing.admin.users.lastSeen")}</th>
              <th scope="col">{t("billing.admin.users.joined")}</th>
            </tr>
          </thead>
          <tbody>
            {users.length === 0 && <tr><td colSpan={7} className="admin-empty">{t("billing.admin.users.empty")}</td></tr>}
            {users.map((user) => {
              const name = user.displayName || user.email;
              return (
                <tr key={user.id}>
                  <td>
                    <div className="admin-user">
                      <span className="admin-avatar" aria-hidden="true">{user.avatarUrl ? <img src={user.avatarUrl} alt="" /> : name[0]?.toUpperCase()}</span>
                      <span><strong>{name}</strong><small>{user.email}</small></span>
                    </div>
                  </td>
                  <td>
                    <div className="admin-plan-cell">
                      <select
                        className={`admin-plan-select plan-${user.plan}`}
                        value={user.adminPlan ?? ""}
                        disabled={saving === user.id}
                        aria-label={t("billing.admin.users.give", { name })}
                        onChange={(event) => void give(user, event.target.value as "" | PlanId)}
                      >
                        <option value="">{t("billing.admin.users.automatic")}{user.source === "stripe" ? ` · ${t(`billing.plans.${user.plan}.name`)}` : ""}</option>
                        {planOptions.map((id) => <option key={id} value={id}>{t(`billing.plans.${id}.name`)}</option>)}
                      </select>
                      <span className={`admin-source is-${user.source}`}>
                        {saved === user.id ? t("billing.admin.users.saved") : user.cancelAtPeriodEnd ? t("billing.admin.users.canceling") : t(`billing.admin.users.source.${user.source}`)}
                      </span>
                    </div>
                  </td>
                  <td className="is-num">{user.revenueCents ? formatMoney(user.revenueCents, lang, "eur") : "—"}</td>
                  <td className="is-num">{user.aiCost30dMicros ? usd(user.aiCost30dMicros, lang) : "—"}</td>
                  <td className="is-num">{user.agentTokensMonth ? formatTokens(user.agentTokensMonth, lang) : "—"}</td>
                  <td className="admin-dim">{relative(user.lastLoginAt, lang)}</td>
                  <td className="admin-dim">{new Intl.DateTimeFormat(lang, { day: "numeric", month: "short", year: "numeric" }).format(new Date(user.createdAt))}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {total > PAGE_SIZE && (
        <div className="admin-pager">
          <button type="button" disabled={page === 0} onClick={() => setPage((value) => Math.max(0, value - 1))}><Icon name="chevron-left" />{t("billing.admin.users.previous")}</button>
          <button type="button" disabled={to >= total} onClick={() => setPage((value) => value + 1)}>{t("billing.admin.users.next")}<Icon name="chevron-right" /></button>
        </div>
      )}
    </section>
  );
}
