import AlertActions from '@/components/AlertActions';
import PromptVersionActions from '@/components/PromptVersionActions';
import RunChecksButton from '@/components/RunChecksButton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BarChart, HBarList, Sparkline, StackedBar } from '@/components/charts';
import PageHeader from '@/components/PageHeader';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { getDb } from '@/lib/db';
import { computeMetrics, type MetricTicket, type Metrics } from '@/lib/metrics';
import { containsPII } from '@/lib/redact';
import { RULES, TICKET_METRIC_COLUMNS, formatMetric, type AlertRow } from '@/lib/monitor';

export const dynamic = 'force-dynamic';

interface VersionRow {
  id: string;
  status: 'draft' | 'live' | 'standby' | 'retired';
  created_at: string;
  notes: string | null;
}

interface RunRow {
  id: string;
  created_at: string;
  prompt_version_id: string;
  dataset: 'golden' | 'adversarial' | 'drift';
  model: string;
  total: number;
  passed: number;
  score: string | number;
  regressions: number;
}

type GroupedTicket = MetricTicket & { prompt_version_id: string };

// Per-metric series over tickets ordered oldest → newest. Rates are cumulative so the line shows how the SLO evolved.
function metricSeries(tickets: MetricTicket[], metric: keyof Metrics): number[] {
  const cumulative = (hit: (t: MetricTicket) => boolean, include: (t: MetricTicket) => boolean = () => true) => {
    let seen = 0;
    let hits = 0;
    const out: number[] = [];
    for (const t of tickets) {
      if (!include(t)) continue;
      seen++;
      if (hit(t)) hits++;
      out.push(hits / seen);
    }
    return out;
  };
  switch (metric) {
    case 'live_accuracy':
      return cumulative(
        (t) => t.decision === t.expected_decision && t.reason_code === t.expected_reason_code,
        (t) => t.expected_decision !== null && t.expected_reason_code !== null,
      );
    case 'p95_latency_ms':
      return tickets.map((t) => t.latency_ms);
    case 'llm_error_rate':
      return cumulative((t) => t.llm_error);
    case 'escalation_rate':
      return cumulative((t) => t.decision === 'escalate');
    case 'injection_rate':
      return cumulative((t) => t.injection_detected === true);
    case 'avg_cost_usd':
      return tickets.map((t) => Number(t.cost_usd));
    case 'pii_leaks': {
      let leaks = 0;
      return tickets.map((t) => (containsPII(t.body_redacted) ? ++leaks : leaks));
    }
  }
}

const pct = (v: number | null) => (v === null ? 'n/a' : `${(v * 100).toFixed(1)}%`);
const ms = (v: number | null) => (v === null ? 'n/a' : `${Math.round(v)} ms`);
const usd = (v: number | null) => (v === null ? 'n/a' : `$${v.toFixed(4)}`);
const int = (v: number | null) => (v === null ? 'n/a' : String(v));

const SLOS: { metric: keyof Metrics; title: string; target: string; format: (v: number | null) => string }[] = [
  { metric: 'live_accuracy', title: 'Live accuracy', target: '≥ 85%', format: pct },
  { metric: 'p95_latency_ms', title: 'p95 latency', target: '≤ 8000 ms', format: ms },
  { metric: 'llm_error_rate', title: 'LLM error rate', target: '≤ 10%', format: pct },
  { metric: 'escalation_rate', title: 'Escalation rate', target: '≤ 40%', format: pct },
  { metric: 'injection_rate', title: 'Injection rate', target: '≤ 20%', format: pct },
  { metric: 'avg_cost_usd', title: 'Avg cost / ticket', target: '≤ $0.01', format: usd },
  { metric: 'pii_leaks', title: 'PII leaks', target: '0', format: int },
];

const isBreached = (metric: keyof Metrics, value: number | null) => {
  const def = RULES.find((r) => r.metric === metric);
  return value !== null && def !== undefined && def.breached(value, def.threshold);
};

const HEAD = 'text-xs font-medium uppercase tracking-wide text-muted-foreground';

function Headers({ names }: { names: string[] }) {
  return (
    <TableHeader>
      <TableRow className="hover:bg-transparent">
        {names.map((h, i) => (
          <TableHead key={i} className={HEAD}>{h}</TableHead>
        ))}
      </TableRow>
    </TableHeader>
  );
}

function Empty({ cols, text }: { cols: number; text: string }) {
  return (
    <TableRow className="hover:bg-transparent">
      <TableCell colSpan={cols} className="py-8 text-center text-muted-foreground">{text}</TableCell>
    </TableRow>
  );
}

export default async function OpsPage() {
  const db = getDb();
  const [recent, live200, alertsRes, versionsRes, runsRes] = await Promise.all([
    db.from('tickets').select(TICKET_METRIC_COLUMNS).order('created_at', { ascending: false }).limit(50),
    db.from('tickets').select(`${TICKET_METRIC_COLUMNS}, prompt_version_id`).order('created_at', { ascending: false }).limit(200),
    db.from('alerts').select('*').in('status', ['open', 'acknowledged']).order('created_at', { ascending: false }),
    db.from('prompt_versions').select('id, status, created_at, notes').order('created_at', { ascending: true }),
    db.from('eval_runs').select('*').order('created_at', { ascending: false }).limit(200),
  ]);

  const loadError = [recent, live200, alertsRes, versionsRes, runsRes].find((r) => r.error)?.error;
  const recentTickets = (recent.data ?? []) as unknown as MetricTicket[];
  const chronological = [...recentTickets].reverse(); // oldest → newest for charts
  const metrics = computeMetrics(recentTickets);
  const alerts = (alertsRes.data ?? []) as AlertRow[];
  const versions = (versionsRes.data ?? []) as VersionRow[];
  const runs = (runsRes.data ?? []) as RunRow[];
  const hasStandby = versions.some((v) => v.status === 'standby');

  // Latest run per (version, dataset); runs are newest first.
  const latest = (id: string, dataset: 'golden' | 'adversarial') =>
    runs.find((r) => r.prompt_version_id === id && r.dataset === dataset);

  const byPrompt = new Map<string, GroupedTicket[]>();
  for (const t of (live200.data ?? []) as unknown as GroupedTicket[]) {
    byPrompt.set(t.prompt_version_id, [...(byPrompt.get(t.prompt_version_id) ?? []), t]);
  }

  const decisionCount = (d: string) => recentTickets.filter((t) => t.decision === d).length;
  const reasonCounts = new Map<string, number>();
  for (const t of recentTickets) reasonCounts.set(t.reason_code, (reasonCounts.get(t.reason_code) ?? 0) + 1);
  const topReasons = [...reasonCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([label, value]) => ({ label, value }));
  const latencies = chronological.map((t) => t.latency_ms);
  const latencyMax = Math.max(1000, ...latencies) * 1.1;
  const p95Limit = RULES.find((r) => r.rule === 'P95_LATENCY_HIGH')?.threshold ?? 8000;
  const evalBars = versions.flatMap((v) =>
    (['golden', 'adversarial'] as const).flatMap((dataset) => {
      const run = latest(v.id, dataset);
      if (!run) return [];
      const score = Number(run.score);
      return [{
        label: `${v.id} ${dataset === 'golden' ? 'golden' : 'adv.'}`,
        value: score,
        className: dataset === 'golden' ? 'bg-primary' : 'bg-violet-500',
      }];
    }),
  );

  return (
    <div className="space-y-6">
      <PageHeader title="Operations" description="Service levels, alerts, releases and evaluation history." />
      {loadError && (
        <Alert variant="destructive">
          <AlertDescription>Could not load some data: {loadError.message}</AlertDescription>
        </Alert>
      )}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">Service level objectives</h2>
        <p className="text-sm text-muted-foreground">Last 50 tickets. Metrics show n/a until the minimum sample size is reached.</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {SLOS.map((slo) => {
            const value = metrics[slo.metric];
            const breached = isBreached(slo.metric, value);
            return (
              <Card key={slo.metric} size="sm" className={breached ? 'border-2 border-red-600' : ''}>
                <CardHeader>
                  <CardTitle className="text-sm font-medium text-muted-foreground">{slo.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-semibold tabular-nums">{slo.format(value)}</div>
                  <div className="mt-1 text-xs text-muted-foreground">Target {slo.target}</div>
                  <div className={`mt-3 ${breached ? 'text-red-500' : 'text-primary'}`}>
                    <Sparkline values={metricSeries(chronological, slo.metric)} className="text-current" />
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">Trends</h2>
        <div className="grid gap-3 lg:grid-cols-2">
          <Card>
            <CardHeader><CardTitle>Decision mix</CardTitle></CardHeader>
            <CardContent>
              <StackedBar
                segments={[
                  { label: 'approve', value: decisionCount('approve'), className: 'bg-green-600' },
                  { label: 'deny', value: decisionCount('deny'), className: 'bg-red-600' },
                  { label: 'escalate', value: decisionCount('escalate'), className: 'bg-amber-500' },
                ]}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Top reason codes</CardTitle></CardHeader>
            <CardContent><HBarList items={topReasons} /></CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Latency per ticket (ms)</CardTitle></CardHeader>
            <CardContent>
              <BarChart
                items={chronological.map((t, i) => ({
                  label: `Ticket ${i + 1}`,
                  value: t.latency_ms,
                  className: t.latency_ms > p95Limit ? 'bg-red-500' : 'bg-primary',
                }))}
                max={latencyMax}
                threshold={p95Limit}
                format={(v) => `${Math.round(v)} ms`}
                emptyText="No tickets yet."
              />
              <p className="mt-2 text-xs text-muted-foreground">Oldest to newest, last 50 tickets. Dashed line is the 8 s p95 limit when in range.</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Eval scores by prompt version</CardTitle></CardHeader>
            <CardContent>
              <BarChart
                items={evalBars}
                max={1}
                threshold={0.9}
                format={(v) => `${(v * 100).toFixed(1)}%`}
                emptyText="No eval runs yet."
                showLabels
              />
              <p className="mt-2 text-xs text-muted-foreground">Latest golden (blue) and adversarial (violet) run per version. Dashed line is the 90% release gate.</p>
            </CardContent>
          </Card>
        </div>
      </section>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Alerts</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <RunChecksButton />
          <Table>
            <Headers names={['Time', 'Rule', 'Severity', 'Message', 'Observed', 'Threshold', 'Status', '']} />
            <TableBody>
              {alerts.length === 0 && <Empty cols={8} text="No open alerts." />}
              {alerts.map((a) => (
                <TableRow key={a.id} className={a.severity === 'critical' ? 'border-l-2 border-l-red-600' : ''}>
                  <TableCell>{new Date(a.created_at).toLocaleString()}</TableCell>
                  <TableCell className="font-mono text-xs">{a.rule}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={a.severity === 'critical' ? 'border-red-600 text-red-600' : ''}>{a.severity}</Badge>
                  </TableCell>
                  <TableCell className="max-w-xs whitespace-normal">{a.message}</TableCell>
                  <TableCell className="tabular-nums">{formatMetric(a.rule, Number(a.observed))}</TableCell>
                  <TableCell className="tabular-nums">{formatMetric(a.rule, Number(a.threshold))}</TableCell>
                  <TableCell><Badge variant="outline">{a.status}</Badge></TableCell>
                  <TableCell><AlertActions alertId={a.id} status={a.status as 'open' | 'acknowledged'} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Prompt versions</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <Headers names={['ID', 'Status', 'Created', 'Golden', 'Adversarial', 'Regressions', 'Notes', '']} />
            <TableBody>
              {versions.length === 0 && <Empty cols={8} text="No prompt versions." />}
              {versions.map((v) => {
                const g = latest(v.id, 'golden');
                const a = latest(v.id, 'adversarial');
                const regressions = g || a ? (g?.regressions ?? 0) + (a?.regressions ?? 0) : null;
                return (
                  <TableRow key={v.id}>
                    <TableCell className="font-medium">{v.id}</TableCell>
                    <TableCell><Badge variant="outline">{v.status}</Badge></TableCell>
                    <TableCell>{new Date(v.created_at).toLocaleDateString()}</TableCell>
                    <TableCell className="tabular-nums">{g ? pct(Number(g.score)) : '—'}</TableCell>
                    <TableCell className="tabular-nums">{a ? pct(Number(a.score)) : '—'}</TableCell>
                    <TableCell className="tabular-nums">{regressions ?? '—'}</TableCell>
                    <TableCell className="max-w-xs whitespace-normal text-muted-foreground">{v.notes ?? ''}</TableCell>
                    <TableCell><PromptVersionActions id={v.id} status={v.status} hasStandby={hasStandby} /></TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Live metrics by prompt version</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <Headers names={['Prompt', 'Tickets', 'Accuracy (labeled)', 'p95 ms', 'Avg cost', 'Escalation rate']} />
            <TableBody>
              {byPrompt.size === 0 && <Empty cols={6} text="No tickets yet." />}
              {[...byPrompt.entries()].map(([id, tickets]) => {
                const m = computeMetrics(tickets);
                return (
                  <TableRow key={id}>
                    <TableCell><Badge variant="outline">{id}</Badge></TableCell>
                    <TableCell className="tabular-nums">{tickets.length}</TableCell>
                    <TableCell className="tabular-nums">{pct(m.live_accuracy)}</TableCell>
                    <TableCell className="tabular-nums">{m.p95_latency_ms === null ? 'n/a' : Math.round(m.p95_latency_ms)}</TableCell>
                    <TableCell className="tabular-nums">{usd(m.avg_cost_usd)}</TableCell>
                    <TableCell className="tabular-nums">{pct(m.escalation_rate)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Recent eval runs</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <Headers names={['Time', 'Prompt', 'Dataset', 'Score', 'Passed/Total', 'Regressions', 'Model']} />
            <TableBody>
              {runs.length === 0 && <Empty cols={7} text="No eval runs yet." />}
              {runs.slice(0, 10).map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{new Date(r.created_at).toLocaleString()}</TableCell>
                  <TableCell><Badge variant="outline">{r.prompt_version_id}</Badge></TableCell>
                  <TableCell>{r.dataset}</TableCell>
                  <TableCell className="tabular-nums">{pct(Number(r.score))}</TableCell>
                  <TableCell className="tabular-nums">{r.passed}/{r.total}</TableCell>
                  <TableCell className="tabular-nums">{r.regressions}</TableCell>
                  <TableCell className="text-muted-foreground">{r.model}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
