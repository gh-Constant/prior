import { useState } from "react";
import type { BillingInterval, BillingPlan, BillingState, PlanId } from "../../lib/api";
import { displayMonthlyCents, formatMoney, formatTokens, openBillingPortal, planRank, startCheckout, yearlySavingPercent } from "../../lib/billing";
import { useI18n } from "../../lib/i18n";
import { useResolvedTheme } from "../../lib/theme";
import { Icon } from "../Icon";
import { ShaderCanvas } from "./ShaderCanvas";
import type { CheckoutReturn } from "../../hooks/useBilling";
import "./PricingView.css";

type Props = {
  readonly billing: BillingState | null;
  readonly signedIn: boolean;
  readonly checkoutReturn: CheckoutReturn;
  readonly onDismissCheckoutReturn: () => void;
};

const FEATURED: PlanId = "pro";

function formatDate(value: string | undefined, lang: string): string {
  if (!value) return "";
  return new Intl.DateTimeFormat(lang, { day: "numeric", month: "long", year: "numeric" }).format(new Date(value));
}

function featureVars(plan: BillingPlan, lang: string): Record<string, string | number> {
  return {
    projects: plan.maxSharedProjects,
    people: plan.maxMembersPerProject,
    tokens: formatTokens(plan.agentTokensPerMonth, lang),
  };
}

export function PricingView({ billing, signedIn, checkoutReturn, onDismissCheckoutReturn }: Props) {
  const { t, lang } = useI18n();
  const theme = useResolvedTheme();
  const [interval, setBillingInterval] = useState<BillingInterval>(billing?.subscription.interval === "year" ? "year" : "month");
  const [busy, setBusy] = useState<PlanId | "portal" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const plans = billing?.plans ?? [];
  const current = billing?.plan ?? "free";
  const saving = yearlySavingPercent(plans);
  const subscribed = billing?.source === "stripe";

  async function choose(plan: PlanId) {
    setError(null);
    setBusy(plan);
    try {
      await startCheckout(plan, interval, lang);
    } catch {
      setError(t("billing.pricing.error"));
      setBusy(null);
    }
  }

  async function manage() {
    setError(null);
    setBusy("portal");
    try {
      await openBillingPortal();
    } catch {
      setError(t("billing.pricing.error"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="pricing-page" aria-labelledby="pricing-title">
      <header className="pricing-hero">
        <div className="pricing-hero-field" aria-hidden="true">
          <ShaderCanvas variant={theme === "dark" ? "dusk" : "dawn"} />
        </div>
        <div className="pricing-hero-copy">
          <span className="pricing-eyebrow">{t("billing.pricing.eyebrow")}</span>
          <h1 id="pricing-title">{t("billing.pricing.title")}</h1>
          <p>{t("billing.pricing.subtitle")}</p>
          <div className="pricing-interval" role="radiogroup" aria-label={t("billing.pricing.intervalLabel")}>
            {(["month", "year"] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={interval === value}
                className={interval === value ? "is-active" : ""}
                onClick={() => setBillingInterval(value)}
              >
                {value === "month" ? t("billing.pricing.monthly") : t("billing.pricing.yearly")}
                {value === "year" && saving > 0 && <span className="pricing-save">{t("billing.pricing.save", { percent: saving })}</span>}
              </button>
            ))}
          </div>
        </div>
      </header>

      {checkoutReturn && (
        <div className={`pricing-notice ${checkoutReturn === "success" ? "is-success" : ""}`} role="status">
          <Icon name={checkoutReturn === "success" ? "check-circle" : "arrow"} />
          <span>
            {checkoutReturn === "cancel"
              ? t("billing.checkout.cancel")
              : current !== "free"
                ? t("billing.checkout.success", { plan: t(`billing.plans.${current}.name`) })
                : t("billing.checkout.pending")}
          </span>
          <button type="button" className="pricing-notice-close" onClick={onDismissCheckoutReturn} aria-label={t("billing.checkout.dismiss")}>
            <Icon name="close" />
          </button>
        </div>
      )}

      {billing && <CurrentPlan billing={billing} busy={busy === "portal"} onManage={() => void manage()} />}
      {!signedIn && <p className="pricing-muted">{t("billing.pricing.signInRequired")}</p>}
      {signedIn && !billing && <p className="pricing-muted">{t("billing.pricing.loading")}</p>}
      {billing && !billing.stripeEnabled && <p className="pricing-muted">{t("billing.pricing.unavailable")}</p>}
      {error && <p className="pricing-error" role="alert">{error}</p>}

      {plans.length > 0 && (
        <div className="pricing-grid">
          {plans.map((plan) => {
            const isCurrent = plan.id === current;
            const featured = plan.id === FEATURED;
            const monthly = displayMonthlyCents(plan, interval);
            const vars = featureVars(plan, lang);
            const name = t(`billing.plans.${plan.id}.name`);
            let action: { label: string; onClick?: () => void; disabled?: boolean } | null = null;
            if (isCurrent) action = { label: t("billing.pricing.current"), disabled: true };
            else if (plan.monthlyCents > 0 && billing?.stripeEnabled) {
              action = subscribed
                ? { label: t("billing.pricing.switchTo", { plan: name }), onClick: () => void manage() }
                : { label: t("billing.pricing.choose", { plan: name }), onClick: () => void choose(plan.id) };
            }
            return (
              <article key={plan.id} className={`pricing-card plan-${plan.id} ${featured ? "is-featured" : ""} ${isCurrent ? "is-current" : ""}`} aria-labelledby={`plan-${plan.id}-name`}>
                {featured && <div className="pricing-card-field" aria-hidden="true"><ShaderCanvas variant="ember" /></div>}
                <div className="pricing-card-body">
                  <div className="pricing-card-head">
                    <h2 id={`plan-${plan.id}-name`}>{name}</h2>
                    {featured && !isCurrent && <span className="pricing-badge">{t("billing.pricing.popular")}</span>}
                    {isCurrent && <span className="pricing-badge is-current">{t("billing.pricing.current")}</span>}
                  </div>
                  <p className="pricing-tagline">{t(`billing.plans.${plan.id}.tagline`)}</p>
                  <div className="pricing-price">
                    {plan.monthlyCents > 0 ? (
                      <>
                        <span className="pricing-amount">{formatMoney(monthly, lang, billing?.currency)}</span>
                        <span className="pricing-per">{t("billing.pricing.perMonth")}</span>
                      </>
                    ) : (
                      <span className="pricing-amount">{formatMoney(0, lang, billing?.currency)}</span>
                    )}
                  </div>
                  <p className="pricing-billed">
                    {plan.monthlyCents === 0
                      ? t("billing.pricing.freeForever")
                      : interval === "year"
                        ? t("billing.pricing.billedYearly", { amount: formatMoney(plan.yearlyCents, lang, billing?.currency) })
                        : t("billing.pricing.billedMonthly")}
                  </p>
                  {action && (
                    <button
                      type="button"
                      className={`pricing-cta ${featured ? "is-primary" : ""}`}
                      disabled={action.disabled || busy !== null}
                      aria-busy={busy === plan.id}
                      onClick={action.onClick}
                    >
                      {busy === plan.id ? t("billing.pricing.redirecting") : action.label}
                    </button>
                  )}
                  <ul className="pricing-features">
                    {(["f1", "f2", "f3", "f4"] as const).map((key) => (
                      <li key={key}><Icon name="check" /><span>{t(`billing.plans.${plan.id}.${key}`, vars)}</span></li>
                    ))}
                  </ul>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {plans.length > 0 && <Comparison plans={plans} current={current} />}
      {plans.length > 0 && <p className="pricing-muted pricing-tax">{t("billing.pricing.taxNote")}</p>}

      <section className="pricing-faq" aria-labelledby="pricing-faq-title">
        <h2 id="pricing-faq-title">{t("billing.faq.title")}</h2>
        {(["1", "2", "3"] as const).map((index) => (
          <details key={index}>
            <summary><span>{t(`billing.faq.q${index}`)}</span><Icon name="chevron-down" /></summary>
            <p>{t(`billing.faq.a${index}`)}</p>
          </details>
        ))}
      </section>
    </section>
  );
}

function CurrentPlan({ billing, busy, onManage }: { readonly billing: BillingState; readonly busy: boolean; readonly onManage: () => void }) {
  const { t, lang } = useI18n();
  const { subscription, entitlements } = billing;
  const limit = entitlements.agentTokensPerMonth;
  const used = entitlements.agentTokensUsed;
  const share = limit > 0 ? Math.min(1, used / limit) : 0;
  let line = t("billing.status.freeLine");
  if (billing.source === "admin") line = t("billing.status.granted");
  else if (billing.source === "stripe" && subscription.status === "past_due") line = t("billing.status.pastDue");
  else if (billing.source === "stripe" && subscription.currentPeriodEnd) {
    line = subscription.cancelAtPeriodEnd
      ? t("billing.status.ends", { date: formatDate(subscription.currentPeriodEnd, lang) })
      : t("billing.status.renews", { date: formatDate(subscription.currentPeriodEnd, lang) });
  }
  return (
    <div className={`pricing-current plan-${billing.plan}`}>
      <div className="pricing-current-main">
        <span className="pricing-current-dot" aria-hidden="true" />
        <div>
          <strong>{t(`billing.plans.${billing.plan}.name`)}</strong>
          <span className={subscription.status === "past_due" && billing.source === "stripe" ? "is-warning" : ""}>{line}</span>
        </div>
      </div>
      {entitlements.hostedAI && (
        <div className="pricing-usage">
          <div className="pricing-usage-label">
            <span>{t("billing.status.usage")}</span>
            <span>{limit > 0 ? t("billing.status.usageValue", { used: formatTokens(used, lang), limit: formatTokens(limit, lang) }) : t("billing.status.unlimited")}</span>
          </div>
          {limit > 0 && (
            <div className="pricing-usage-track" role="progressbar" aria-valuemin={0} aria-valuemax={limit} aria-valuenow={used} aria-label={t("billing.status.usage")}>
              <span style={{ width: `${share * 100}%` }} className={share > 0.9 ? "is-high" : ""} />
            </div>
          )}
        </div>
      )}
      {billing.hasBillingPortal && (
        <button type="button" className="pricing-manage" disabled={busy} onClick={onManage}>
          <Icon name="credit-card" />
          <span>{t("billing.pricing.manage")}</span>
        </button>
      )}
    </div>
  );
}

function Comparison({ plans, current }: { readonly plans: readonly BillingPlan[]; readonly current: PlanId }) {
  const { t, lang } = useI18n();
  const sorted = [...plans].sort((a, b) => planRank(a.id) - planRank(b.id));
  const limit = (value: number) => (value > 0 ? String(value) : t("billing.compare.unlimited"));
  const rows: Array<{ key: string; cell: (plan: BillingPlan) => string | boolean }> = [
    { key: "recommendations", cell: (plan) => plan.hostedAI },
    { key: "dictation", cell: (plan) => plan.hostedAI },
    { key: "agentTokens", cell: (plan) => (plan.agentTokensPerMonth > 0 ? formatTokens(plan.agentTokensPerMonth, lang) : false) },
    { key: "peoplePerProject", cell: (plan) => limit(plan.maxMembersPerProject) },
    { key: "sharedProjects", cell: (plan) => limit(plan.maxSharedProjects) },
    { key: "sync", cell: () => true },
    { key: "byok", cell: () => true },
  ];
  return (
    <section className="pricing-compare" aria-labelledby="pricing-compare-title">
      <h2 id="pricing-compare-title">{t("billing.compare.title")}</h2>
      <div className="pricing-compare-scroll">
        <table>
          <thead>
            <tr>
              <th scope="col">{t("billing.compare.feature")}</th>
              {sorted.map((plan) => <th scope="col" key={plan.id} className={plan.id === current ? "is-current" : ""}>{t(`billing.plans.${plan.id}.name`)}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <th scope="row">{t(`billing.compare.${row.key}`)}</th>
                {sorted.map((plan) => {
                  const value = row.cell(plan);
                  return (
                    <td key={plan.id} className={plan.id === current ? "is-current" : ""}>
                      {value === true ? <><Icon name="check" /><span className="sr-only">{t("billing.compare.yes")}</span></>
                        : value === false ? <span className="pricing-no" aria-label={t("billing.compare.no")}>—</span>
                          : value}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
