import AlertActions from '@/components/AlertActions';
import PromptVersionActions from '@/components/PromptVersionActions';
import RunChecksButton from '@/components/RunChecksButton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { getDb } from '@/lib/db';
import { computeMetrics, type MetricTicket, type Metrics } from '@/lib/metrics';
import { RULES, TICKET_METRIC_COLUMNS, type AlertRow } from '@/lib/monitor';

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
  const metrics = computeMetrics((recent.data ?? []) as unknown as MetricTicket[]);
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

  return (
    <div className="space-y-6">
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
                </CardContent>
              </Card>
            );
          })}
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
                  <TableCell className="tabular-nums">{Number(a.observed)}</TableCell>
                  <TableCell className="tabular-nums">{Number(a.threshold)}</TableCell>
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
