import Link from 'next/link';
import PageHeader from '@/components/PageHeader';
import { HBarList, Ring, Sparkline, StackedBar, StackedColumns } from '@/components/charts';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getDb } from '@/lib/db';
import { computeMetrics, type MetricTicket } from '@/lib/metrics';
import { RULES, formatMetric } from '@/lib/monitor';
import { containsPII } from '@/lib/redact';

export const dynamic = 'force-dynamic';

// Illustrative business assumptions (not measured): what a support agent costs per manually handled refund email.
const MANUAL_COST_PER_TICKET_USD = 4.5;
const MANUAL_HANDLE_MINUTES = 6;
const DAYS = 14;

interface T extends MetricTicket {
  created_at: string;
  status: string;
  refund_amount_cents: number;
  redaction_count: number;
  order_id_extracted: string | null;
}

const usd = (v: number) => v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: v >= 100 ? 0 : 2 });
const pct = (v: number | null) => (v === null ? 'n/a' : `${(v * 100).toFixed(1)}%`);

function Kpi({ label, value, hint, series, href, tone }: {
  label: string; value: React.ReactNode; hint: string; series?: number[]; href?: string; tone?: 'bad';
}) {
  return (
    <Card size="sm" className={tone === 'bad' ? 'border-2 border-red-600' : ''}>
      <CardContent className="space-y-1">
        <div className="flex items-center justify-between text-xs uppercase tracking-wide text-muted-foreground">
          <span>{label}</span>
          {href && <Link href={href} className="normal-case hover:text-foreground">Details →</Link>}
        </div>
        <div className="text-2xl font-semibold tabular-nums">{value}</div>
        <div className="text-xs text-muted-foreground">{hint}</div>
        {series && <div className="pt-2"><Sparkline values={series} /></div>}
      </CardContent>
    </Card>
  );
}

function Panel({ title, href, children, className = '' }: { title: string; href?: string; children: React.ReactNode; className?: string }) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {href && <CardAction><Link href={href} className="text-xs text-muted-foreground hover:text-foreground">Details →</Link></CardAction>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

const SLO_LABEL: Record<string, string> = {
  live_accuracy: 'Live accuracy', llm_error_rate: 'LLM error rate', pii_leaks: 'PII leaks', p95_latency_ms: 'p95 latency',
  escalation_rate: 'Escalation rate', injection_rate: 'Injection rate', avg_cost_usd: 'Avg cost / ticket',
};

export default async function DashboardPage() {
  const db = getDb();
  const [ticketsRes, ordersRes, versionsRes, runsRes, alertsRes] = await Promise.all([
    db.from('tickets')
      .select('created_at, decision, reason_code, status, refund_amount_cents, latency_ms, cost_usd, llm_error, injection_detected, redaction_count, expected_decision, expected_reason_code, body_redacted, order_id_extracted')
      .order('created_at', { ascending: false })
      .limit(1000),
    db.from('orders').select('id, amount_cents'),
    db.from('prompt_versions').select('id, status').order('created_at', { ascending: true }),
    db.from('eval_runs').select('prompt_version_id, dataset, score, regressions').order('created_at', { ascending: false }).limit(100),
    db.from('alerts').select('rule, severity, status, created_at, observed').in('status', ['open', 'acknowledged']).order('created_at', { ascending: false }),
  ]);

  const newest = (ticketsRes.data ?? []) as unknown as T[]; // newest first
  const chronological = [...newest].reverse();
  const orderValue = new Map((ordersRes.data ?? []).map((o) => [o.id as string, (o.amount_cents as number) / 100]));
  const versions = versionsRes.data ?? [];
  const runs = runsRes.data ?? [];
  const activeAlerts = alertsRes.data ?? [];

  // Daily buckets for the last DAYS days.
  const dayKey = (d: Date) => d.toISOString().slice(0, 10);
  const today = new Date();
  const days = Array.from({ length: DAYS }, (_, i) => {
    const d = new Date(today.getTime() - (DAYS - 1 - i) * 86_400_000);
    return { key: dayKey(d), label: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) };
  });
  const byDay = new Map(days.map((d) => [d.key, [] as T[]]));
  for (const t of chronological) byDay.get(dayKey(new Date(t.created_at)))?.push(t);
  const daily = days.map((d) => ({ ...d, tickets: byDay.get(d.key) ?? [] }));

  // Business numbers.
  const total = newest.length;
  const automated = newest.filter((t) => t.decision !== 'escalate').length;
  const automationRate = total ? automated / total : null;
  const approvedUsd = newest.filter((t) => t.decision === 'approve').reduce((n, t) => n + t.refund_amount_cents / 100, 0);
  const queue = newest.filter((t) => t.status === 'pending_approval');
  const queueUsd = queue.reduce((n, t) => n + (orderValue.get(t.order_id_extracted ?? '') ?? 0), 0);
  const aiCost = newest.reduce((n, t) => n + Number(t.cost_usd), 0);
  const humanCost = automated * MANUAL_COST_PER_TICKET_USD;
  const savings = humanCost - aiCost;
  const hoursSaved = (automated * MANUAL_HANDLE_MINUTES) / 60;
  const avgSeconds = total ? newest.reduce((n, t) => n + t.latency_ms, 0) / total / 1000 : 0;

  // Value at stake by outcome (order value of the requested refund).
  const stake = (d: string) => newest.filter((t) => t.decision === d).reduce((n, t) => n + (orderValue.get(t.order_id_extracted ?? '') ?? 0), 0);

  // Quality and reliability (same definitions as the Ops page: last 50 tickets).
  const metrics = computeMetrics(newest.slice(0, 50));
  const dailyLatency = daily.map((d) => (d.tickets.length ? d.tickets.reduce((n, t) => n + t.latency_ms, 0) / d.tickets.length : 0));

  // Risk and governance.
  const redacted = newest.reduce((n, t) => n + t.redaction_count, 0);
  const leaks = newest.filter((t) => containsPII(t.body_redacted)).length;
  const injections = newest.filter((t) => t.reason_code === 'INJECTION_SUSPECTED');
  const spoofs = newest.filter((t) => t.reason_code === 'IDENTITY_MISMATCH');
  const heldUsd = [...injections, ...spoofs].reduce((n, t) => n + (orderValue.get(t.order_id_extracted ?? '') ?? 0), 0);
  const escalationReasons = new Map<string, number>();
  for (const t of newest) if (t.decision === 'escalate') escalationReasons.set(t.reason_code, (escalationReasons.get(t.reason_code) ?? 0) + 1);

  const latestRun = (id: string, dataset: string) => runs.find((r) => r.prompt_version_id === id && r.dataset === dataset);
  const breachedCount = RULES.filter((r) => {
    const v = metrics[r.metric];
    return v !== null && r.breached(v, r.threshold);
  }).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader
          title="Executive dashboard"
          description={`RefundDesk at a glance: business impact, AI quality, risk and release status across ${total.toLocaleString()} tickets.`}
        />
        <Link href="/simulate" className={buttonVariants()}>Simulate live cases</Link>
      </div>

      {/* Business KPIs */}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Kpi label="Tickets handled" value={total.toLocaleString()} hint={`${DAYS}-day volume trend`} series={daily.map((d) => d.tickets.length)} href="/" />
        <Kpi label="Automation rate" value={pct(automationRate)} hint="Resolved without a human" series={daily.map((d) => (d.tickets.length ? d.tickets.filter((t) => t.decision !== 'escalate').length / d.tickets.length : 0))} />
        <Kpi label="Refunds approved by AI" value={usd(approvedUsd)} hint="Within the $200 agent limit" series={daily.map((d) => d.tickets.filter((t) => t.decision === 'approve').reduce((n, t) => n + t.refund_amount_cents / 100, 0))} />
        <Kpi label="Awaiting human review" value={queue.length} hint={`${usd(queueUsd)} of refund value in the queue`} href="/approvals" />
        <Kpi label="Estimated savings" value={usd(savings)} hint={`~${hoursSaved.toFixed(0)} agent-hours saved (illustrative)`} />
        <Kpi label="AI cost per ticket" value={`$${(total ? aiCost / total : 0).toFixed(4)}`} hint={`vs ${usd(MANUAL_COST_PER_TICKET_USD)} assumed manual · ${avgSeconds.toFixed(1)}s avg reply`} />
      </section>

      {/* Volume and automation */}
      <section className="grid gap-4 lg:grid-cols-3">
        <Panel title="Ticket volume by outcome" href="/" className="lg:col-span-2">
          <StackedColumns
            columns={daily.map((d) => ({
              label: d.label,
              segments: [
                { label: 'approved', value: d.tickets.filter((t) => t.decision === 'approve').length, className: 'bg-green-600' },
                { label: 'denied', value: d.tickets.filter((t) => t.decision === 'deny').length, className: 'bg-red-600' },
                { label: 'escalated', value: d.tickets.filter((t) => t.decision === 'escalate').length, className: 'bg-amber-500' },
              ],
            }))}
          />
          <div className="mt-3 flex gap-5 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5"><i className="size-2.5 rounded-full bg-green-600" />Approved</span>
            <span className="flex items-center gap-1.5"><i className="size-2.5 rounded-full bg-red-600" />Denied</span>
            <span className="flex items-center gap-1.5"><i className="size-2.5 rounded-full bg-amber-500" />Escalated to a human</span>
          </div>
        </Panel>
        <Panel title="Automation rate">
          <div className="flex justify-center py-2"><Ring value={automationRate} label="of tickets closed by the AI" /></div>
          <p className="mt-2 text-center text-xs text-muted-foreground">{automated.toLocaleString()} automated · {(total - automated).toLocaleString()} sent to people</p>
        </Panel>
      </section>

      {/* Business impact */}
      <section className="grid gap-4 lg:grid-cols-2">
        <Panel title="Cost to serve: AI vs manual (illustrative)">
          <HBarList format={usd} items={[{ label: `Manual handling (${usd(MANUAL_COST_PER_TICKET_USD)}/ticket)`, value: humanCost }, { label: 'AI inference cost', value: aiCost }]} />
          <p className="mt-3 text-xs text-muted-foreground">Assumes {MANUAL_HANDLE_MINUTES} minutes and {usd(MANUAL_COST_PER_TICKET_USD)} of agent time per email. Change the constants at the top of this page to model your own costs.</p>
        </Panel>
        <Panel title="Refund value by outcome">
          <StackedBar
            format={usd}
            segments={[
              { label: 'approved', value: stake('approve'), className: 'bg-green-600' },
              { label: 'escalated', value: stake('escalate'), className: 'bg-amber-500' },
              { label: 'denied', value: stake('deny'), className: 'bg-red-600' },
            ]}
          />
          <p className="mt-3 text-xs text-muted-foreground">Order value of the refunds requested. Escalated value is what a human decides; denied value is what policy protected.</p>
        </Panel>
      </section>

      {/* Quality and reliability */}
      <section className="grid gap-4 lg:grid-cols-3">
        <Panel title="Service level objectives" href="/ops" className="lg:col-span-2">
          <ul className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
            {RULES.map((r) => {
              const v = metrics[r.metric];
              const breached = v !== null && r.breached(v, r.threshold);
              const shown = v === null ? 'n/a' : formatMetric(r.rule, v);
              return (
                <li key={r.rule} className="flex items-center justify-between gap-3 border-b py-1.5 text-sm last:border-0">
                  <span className="flex items-center gap-2">
                    <i className={`size-2.5 rounded-full ${v === null ? 'bg-muted-foreground/40' : breached ? 'bg-red-500' : 'bg-green-500'}`} />
                    {SLO_LABEL[r.metric]}
                  </span>
                  <span className={`tabular-nums ${breached ? 'font-medium text-red-500' : ''}`}>{shown}</span>
                </li>
              );
            })}
          </ul>
          <p className="mt-3 text-xs text-muted-foreground">{breachedCount === 0 ? 'All measured SLOs are healthy.' : `${breachedCount} SLO(s) breached in the last 50 tickets.`}</p>
        </Panel>
        <Panel title="Average latency per day (ms)" href="/ops">
          <Sparkline values={dailyLatency.filter((v) => v > 0)} />
          <p className="mt-2 text-xs text-muted-foreground">p95 over the last 50 tickets: {metrics.p95_latency_ms === null ? 'n/a' : `${Math.round(metrics.p95_latency_ms)} ms`} (limit 8000 ms)</p>
        </Panel>
      </section>

      {/* Risk and governance */}
      <section className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi label="PII items redacted" value={redacted} hint="Removed before the LLM sees the email" href="/safety" />
          <Kpi label="PII leaks stored" value={leaks} hint="Must stay at 0" tone={leaks > 0 ? 'bad' : undefined} />
          <Kpi label="Attacks stopped" value={injections.length + spoofs.length} hint={`${injections.length} injections · ${spoofs.length} identity spoofs`} />
          <Kpi label="Refund value held" value={usd(heldUsd)} hint="Attack-flagged requests sent to a human" />
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="Why tickets go to a human" href="/safety">
            <HBarList items={[...escalationReasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([label, value]) => ({ label, value }))} />
          </Panel>
          <Panel title="Release status and active alerts" href="/ops">
            <div className="space-y-2">
              {versions.length === 0 && <p className="text-sm text-muted-foreground">No prompt versions.</p>}
              {versions.map((v) => {
                const g = latestRun(v.id, 'golden');
                const a = latestRun(v.id, 'adversarial');
                return (
                  <div key={v.id} className="flex items-center justify-between gap-3 text-sm">
                    <span className="flex items-center gap-2"><span className="font-medium">{v.id}</span><Badge variant="outline">{v.status}</Badge></span>
                    <span className="tabular-nums text-muted-foreground">golden {g ? pct(Number(g.score)) : '—'} · adv. {a ? pct(Number(a.score)) : '—'}</span>
                  </div>
                );
              })}
            </div>
            <div className="mt-4 border-t pt-3 text-sm">
              {activeAlerts.length === 0 ? (
                <span className="text-muted-foreground">No active alerts.</span>
              ) : (
                <ul className="space-y-1.5">
                  {activeAlerts.slice(0, 3).map((a, i) => (
                    <li key={i} className="flex items-center justify-between gap-3">
                      <span className="font-mono text-xs">{a.rule}</span>
                      <Badge variant="outline" className={a.severity === 'critical' ? 'border-red-600 text-red-600' : ''}>{a.severity}</Badge>
                    </li>
                  ))}
                  {activeAlerts.length > 3 && <li className="text-xs text-muted-foreground">+{activeAlerts.length - 3} more</li>}
                </ul>
              )}
            </div>
          </Panel>
        </div>
      </section>
    </div>
  );
}
