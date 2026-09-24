import Link from 'next/link';
import PageHeader from '@/components/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { getDb } from '@/lib/db';
import { computeMetrics, type MetricTicket } from '@/lib/metrics';
import { TICKET_METRIC_COLUMNS } from '@/lib/monitor';

export const dynamic = 'force-dynamic';

interface Version { id: string; status: string; notes: string | null; retired_reason: string | null }
interface Run { prompt_version_id: string; dataset: string; score: string | number; regressions: number; created_at: string }

const pct = (v: number | null) => (v === null ? 'n/a' : `${(v * 100).toFixed(1)}%`);

function Stage({ n, title, concept, inApp, evidence, href }: {
  n: number; title: string; concept: string; inApp: string; evidence: React.ReactNode; href?: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <span className="flex size-6 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">{n}</span>
          {href ? <Link href={href} className="hover:underline">{title}</Link> : title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">{concept}</p>
        <p><span className="font-medium">In this app:</span> {inApp}</p>
        <div className="rounded-lg bg-muted p-3 text-xs">{evidence}</div>
      </CardContent>
    </Card>
  );
}

const CONCEPTS: { concept: string; where: string; href?: string }[] = [
  { concept: 'Specify → build → test → evaluate → release → observe → maintain → retire', where: 'This page, stage by stage, with live numbers', href: '/lifecycle' },
  { concept: 'TDD: failing tests first; unit, contract and end-to-end tests; model and tool doubles', where: 'tests/ (policy v2 red then green commits), MockModel, HeuristicModel, ChaosModel' },
  { concept: 'EDD: golden and adversarial sets, error taxonomy, regression evals', where: 'npm run eval, eval history and gate on Ops', href: '/ops' },
  { concept: 'Monitoring: traces, dashboards, SLOs, thresholds, alerts, drift, cost, latency', where: 'Ops dashboard and every ticket\'s trace', href: '/ops' },
  { concept: 'Release: versioned prompts, gated promotion, rollback, retirement', where: 'Prompt versions table on Ops', href: '/ops' },
  { concept: 'Reliability: timeouts, retries, fallbacks, escalation, incident response', where: 'Reliability & Safety page and the runbook', href: '/safety' },
  { concept: 'Security: injection, PII, least privilege, tool authorization, residual risk', where: 'Reliability & Safety page; guardrails on each ticket', href: '/safety' },
  { concept: 'Human in the loop: escalation queue and approvals', where: 'Approvals page', href: '/approvals' },
];

export default async function LifecyclePage() {
  const db = getDb();
  const [versionsRes, runsRes, ticketsRes, alertsRes, humanRes] = await Promise.all([
    db.from('prompt_versions').select('id, status, notes, retired_reason').order('created_at', { ascending: true }),
    db.from('eval_runs').select('prompt_version_id, dataset, score, regressions, created_at').order('created_at', { ascending: false }).limit(100),
    db.from('tickets').select(TICKET_METRIC_COLUMNS).order('created_at', { ascending: false }).limit(50),
    db.from('alerts').select('status, severity'),
    db.from('tickets').select('id', { count: 'exact', head: true }).in('status', ['approved_by_human', 'denied_by_human']),
  ]);
  const versions = (versionsRes.data ?? []) as Version[];
  const runs = (runsRes.data ?? []) as Run[];
  const metrics = computeMetrics((ticketsRes.data ?? []) as unknown as MetricTicket[]);
  const alerts = alertsRes.data ?? [];
  const openAlerts = alerts.filter((a) => a.status !== 'resolved');
  const resolved = alerts.filter((a) => a.status === 'resolved').length;
  const latest = (id: string, dataset: string) => runs.find((r) => r.prompt_version_id === id && r.dataset === dataset);
  const rollbacks = versions.filter((v) => v.notes?.includes('rolled back')).length;
  const retired = versions.filter((v) => v.status === 'retired');

  return (
    <div className="space-y-6">
      <PageHeader title="Lifecycle" description="The GenAI application lifecycle, and where each stage is visible in this running app." />

      <div className="grid gap-4 lg:grid-cols-2">
        <Stage n={1} title="Specify" concept="Write down behavior before building: rules, contracts, thresholds."
          inApp="spec/SPEC.md is the single source of truth: refund policy, guardrails, API contracts, SLOs and alert thresholds."
          evidence="10 policy rules · 5 guardrails · 7 SLO metrics · 7 alert rules" />
        <Stage n={2} title="Build" concept="Keep the probabilistic part small and everything else deterministic."
          inApp="The LLM only extracts facts. Policy, guardrails, replies and refund authorization are plain code behind a swappable model interface."
          evidence="ModelProvider: Anthropic · Heuristic (no key) · Mock (tests) · Chaos (fault injection)" />
        <Stage n={3} title="Test (TDD)" concept="Write failing tests first for deterministic components; use doubles for the model."
          inApp="Policy v2 was written red, committed, then made green. Extraction reliability is tested with a scripted MockModel: retries, timeouts, 401s."
          evidence="Suites: policy · redaction · guardrails · extraction contracts · refund authorization · metrics and alert rules · eval grading" />
        <Stage n={4} title="Evaluate (EDD)" concept="Measure probabilistic behavior offline with golden and adversarial sets, then diagnose by error category."
          href="/ops" inApp="npm run eval grades each case, tags failures (e.g. FOLLOWED_INJECTION) and flags regressions against the live baseline."
          evidence={
            versions.filter((v) => latest(v.id, 'golden') || latest(v.id, 'adversarial')).length === 0 ? 'No eval runs yet. Run: npm run eval -- --prompt v1' : (
              <ul className="space-y-1">
                {versions.map((v) => {
                  const g = latest(v.id, 'golden');
                  const a = latest(v.id, 'adversarial');
                  if (!g && !a) return null;
                  return (
                    <li key={v.id}>
                      <span className="font-medium">{v.id}</span> · golden {g ? pct(Number(g.score)) : '—'} · adversarial {a ? pct(Number(a.score)) : '—'} · regressions {(g?.regressions ?? 0) + (a?.regressions ?? 0)}
                    </li>
                  );
                })}
              </ul>
            )
          } />
        <Stage n={5} title="Release" concept="Version prompts like code. Promotion is gated by evidence."
          href="/ops" inApp="A prompt version moves draft → live → standby → retired. Promote is refused unless golden and adversarial both score 90% or more with no regressions."
          evidence={<div className="flex flex-wrap gap-2">{versions.map((v) => <Badge key={v.id} variant="outline">{v.id}: {v.status}</Badge>)}</div>} />
        <Stage n={6} title="Observe" concept="Traces, SLOs and alerts tell you when the running system is unhealthy."
          href="/ops" inApp="Every ticket records a trace. The Ops page shows SLO cards, trends and alerts; a daily cron runs the same checks."
          evidence={<>Last 50 tickets · live accuracy {pct(metrics.live_accuracy)} · p95 {metrics.p95_latency_ms === null ? 'n/a' : `${Math.round(metrics.p95_latency_ms)} ms`} · <span className={openAlerts.length ? 'font-medium text-red-500' : ''}>{openAlerts.length} active alert(s)</span></>} />
        <Stage n={7} title="Maintain" concept="Decide: roll back, fix forward, or wait. Releases and the world both change."
          href="/safety" inApp="Runbook rules: a release-caused critical alert means roll back first; drift or a provider outage means fix forward or wait. Humans clear the approvals queue."
          evidence={`${resolved} alert(s) resolved · ${rollbacks} rollback(s) · ${humanRes.count ?? 0} tickets decided by a human`} />
        <Stage n={8} title="Retire" concept="Old versions are retired with a recorded reason so nobody re-promotes them."
          href="/ops" inApp="Retire is only allowed on non-live versions and needs a reason."
          evidence={retired.length === 0 ? 'No retired versions yet.' : <ul>{retired.map((v) => <li key={v.id}><span className="font-medium">{v.id}</span>: {v.retired_reason}</li>)}</ul>} />
      </div>

      <Card>
        <CardHeader><CardTitle>Test-driven vs eval-driven development</CardTitle></CardHeader>
        <CardContent className="grid gap-4 text-sm md:grid-cols-2">
          <div className="space-y-2">
            <Badge variant="outline">Deterministic code → TDD</Badge>
            <p className="text-muted-foreground">Same input, same output, so tests are exact. Write the failing test, watch it fail, then make it pass. Policy, redaction, guardrails, replies and authorization work this way.</p>
          </div>
          <div className="space-y-2">
            <Badge variant="outline">Probabilistic model → EDD</Badge>
            <p className="text-muted-foreground">Outputs vary, so you measure. Run golden and adversarial sets, read the error taxonomy, and gate releases on scores and regressions. Improve the prompt, not the code, and re-run.</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Where each course concept shows up</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="text-xs uppercase tracking-wide text-muted-foreground">Concept</TableHead>
                <TableHead className="text-xs uppercase tracking-wide text-muted-foreground">Where to see it</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {CONCEPTS.map((c) => (
                <TableRow key={c.concept}>
                  <TableCell className="max-w-md whitespace-normal">{c.concept}</TableCell>
                  <TableCell className="whitespace-normal">
                    {c.href ? <Link href={c.href} className="text-primary underline-offset-4 hover:underline">{c.where}</Link> : c.where}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
