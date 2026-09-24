import PageHeader from '@/components/PageHeader';
import { BarChart, HBarList } from '@/components/charts';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { HIGH_VALUE_CENTS, LLM_BACKOFF_MS, LLM_MAX_ATTEMPTS, LLM_TIMEOUT_MS } from '@/lib/config';
import { getDb } from '@/lib/db';
import { containsPII } from '@/lib/redact';
import { formatMetric, type AlertRow } from '@/lib/monitor';

export const dynamic = 'force-dynamic';

interface T { reason_code: string; decision: string; redaction_count: number; body_redacted: string; refund_amount_cents: number; status: string; llm_error: boolean }

function Stat({ label, value, hint, tone }: { label: string; value: React.ReactNode; hint: string; tone?: 'bad' }) {
  return (
    <Card size="sm" className={tone === 'bad' ? 'border-2 border-red-600' : ''}>
      <CardContent>
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
        <div className="mt-1 text-xs text-muted-foreground">{hint}</div>
      </CardContent>
    </Card>
  );
}

const duration = (from: string, to: string | null) => {
  if (!to) return 'still active';
  const mins = Math.round((new Date(to).getTime() - new Date(from).getTime()) / 60000);
  return mins < 90 ? `${mins} min` : `${(mins / 60).toFixed(1)} h`;
};

export default async function SafetyPage() {
  const db = getDb();
  const [ticketsRes, retriedOk, timeouts, http5xx, alertsRes, chaosRes, failuresRes] = await Promise.all([
    db.from('tickets').select('reason_code, decision, redaction_count, body_redacted, refund_amount_cents, status, llm_error').order('created_at', { ascending: false }).limit(1000),
    db.from('spans').select('id', { count: 'exact', head: true }).eq('name', 'llm.extract').eq('attempt', 2).eq('status', 'ok'),
    db.from('spans').select('id', { count: 'exact', head: true }).eq('name', 'llm.extract').ilike('error_message', '%timed out%'),
    db.from('spans').select('id', { count: 'exact', head: true }).eq('name', 'llm.extract').ilike('error_message', '%HTTP 5%'),
    db.from('alerts').select('*').order('created_at', { ascending: false }).limit(15),
    db.from('chaos_config').select('mode').eq('id', 1).maybeSingle(),
    db.from('eval_results').select('failure_category').not('failure_category', 'is', null),
  ]);

  const tickets = (ticketsRes.data ?? []) as T[];
  const alerts = (alertsRes.data ?? []) as AlertRow[];
  const chaos = chaosRes.data?.mode ?? 'none';
  const count = (fn: (t: T) => boolean) => tickets.filter(fn).length;

  const fallbacks = count((t) => t.llm_error);
  const redacted = count((t) => t.redaction_count > 0);
  const redactedItems = tickets.reduce((n, t) => n + t.redaction_count, 0);
  const leaks = count((t) => containsPII(t.body_redacted));
  const injections = count((t) => t.reason_code === 'INJECTION_SUSPECTED');
  const spoofs = count((t) => t.reason_code === 'IDENTITY_MISMATCH');
  const highValue = count((t) => t.reason_code === 'HIGH_VALUE_REVIEW');
  const humanApproved = count((t) => t.status === 'approved_by_human');
  const agentApproved = count((t) => t.decision === 'approve' && t.refund_amount_cents <= HIGH_VALUE_CENTS);

  const escalationReasons = new Map<string, number>();
  for (const t of tickets) if (t.decision === 'escalate') escalationReasons.set(t.reason_code, (escalationReasons.get(t.reason_code) ?? 0) + 1);
  const escalationList = [...escalationReasons.entries()].sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value }));

  const failureCounts = new Map<string, number>();
  for (const r of failuresRes.data ?? []) failureCounts.set(r.failure_category, (failureCounts.get(r.failure_category) ?? 0) + 1);
  const failureBars = [...failureCounts.entries()].sort((a, b) => b[1] - a[1]);

  return (
    <div className="space-y-8">
      <PageHeader title="Reliability & Safety" description={`Based on the latest ${tickets.length} tickets: how the system copes with failure and attack.`} />

      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">Reliability and incident response</h2>
        <p className="text-sm text-muted-foreground">
          Every LLM call has a {LLM_TIMEOUT_MS / 1000}s timeout and up to {LLM_MAX_ATTEMPTS} attempts with a {LLM_BACKOFF_MS} ms backoff. If all attempts fail the ticket is
          escalated to a human (fallback) instead of guessing. Retries cover timeouts, 429s, 5xx and unparseable output; a 401 fails immediately.
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Saved by retry" value={retriedOk.count ?? 0} hint="First call failed, second succeeded" />
          <Stat label="Fell back to human" value={fallbacks} hint="All attempts failed → LLM_UNAVAILABLE" />
          <Stat label="Timeouts" value={timeouts.count ?? 0} hint={`Calls slower than ${LLM_TIMEOUT_MS / 1000}s`} />
          <Stat label="Provider 5xx" value={http5xx.count ?? 0} hint="Upstream server errors" />
        </div>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Fault injection <Badge variant="outline" className={chaos !== 'none' ? 'border-red-600 text-red-600' : ''}>chaos: {chaos}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Practice incident response on demand: <code className="rounded bg-muted px-1.5 py-0.5 text-foreground">npm run chaos -- errors</code> makes every call fail with 503,{' '}
            <code className="rounded bg-muted px-1.5 py-0.5 text-foreground">latency</code> makes every call wait 9 s, <code className="rounded bg-muted px-1.5 py-0.5 text-foreground">none</code> restores normal operation.
            Then send traffic and watch the alerts fire on the Ops page.
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Alert history and incident timeline</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  {['Fired', 'Rule', 'Severity', 'Observed', 'Status', 'Time to resolve'].map((h) => (
                    <TableHead key={h} className="text-xs uppercase tracking-wide text-muted-foreground">{h}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {alerts.length === 0 && (
                  <TableRow className="hover:bg-transparent"><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">No alerts have fired.</TableCell></TableRow>
                )}
                {alerts.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell>{new Date(a.created_at).toLocaleString()}</TableCell>
                    <TableCell className="font-mono text-xs">{a.rule}</TableCell>
                    <TableCell><Badge variant="outline" className={a.severity === 'critical' ? 'border-red-600 text-red-600' : ''}>{a.severity}</Badge></TableCell>
                    <TableCell className="tabular-nums">{formatMetric(a.rule, Number(a.observed))}</TableCell>
                    <TableCell><Badge variant="outline">{a.status}</Badge></TableCell>
                    <TableCell>{duration(a.created_at, a.resolved_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">Operational security and governance</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="PII redacted" value={redactedItems} hint={`${redacted} tickets had card numbers or SSNs removed before the LLM saw them`} />
          <Stat label="PII leaks stored" value={leaks} hint="Must stay 0 (critical alert otherwise)" tone={leaks > 0 ? 'bad' : undefined} />
          <Stat label="Injections escalated" value={injections} hint="Email tried to instruct the AI" />
          <Stat label="Identity spoofs stopped" value={spoofs} hint="Sender did not match the order" />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader><CardTitle>Why tickets were escalated</CardTitle></CardHeader>
            <CardContent><HBarList items={escalationList.slice(0, 8)} /></CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Least privilege and tool authorization</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="text-xs uppercase tracking-wide text-muted-foreground">Actor</TableHead>
                    <TableHead className="text-xs uppercase tracking-wide text-muted-foreground">May refund</TableHead>
                    <TableHead className="text-xs uppercase tracking-wide text-muted-foreground">So far</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow><TableCell>Agent</TableCell><TableCell className="whitespace-normal">Delivered orders, exact amount, ≤ $200</TableCell><TableCell>{agentApproved} approved</TableCell></TableRow>
                  <TableRow><TableCell>Human</TableCell><TableCell className="whitespace-normal">Delivered orders, exact amount, no cap</TableCell><TableCell>{humanApproved} approved</TableCell></TableRow>
                </TableBody>
              </Table>
              <p className="text-xs text-muted-foreground">{highValue} high-value requests were routed to a human. Emails cannot change these limits: authorization is code, not prompt text. The database blocks all direct access except the server (row-level security, service key only on the server).</p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader><CardTitle>Red-team findings and residual risk</CardTitle></CardHeader>
          <CardContent className="grid gap-4 text-sm lg:grid-cols-2">
            <div>
              <p className="mb-2 text-muted-foreground">Failures found by the adversarial and golden evals, by category (all runs):</p>
              {failureBars.length === 0 ? (
                <p className="text-muted-foreground">No eval failures recorded yet.</p>
              ) : (
                <BarChart items={failureBars.map(([label, value]) => ({ label, value, className: 'bg-red-500' }))} max={Math.max(...failureBars.map((f) => f[1])) * 1.1} showLabels />
              )}
            </div>
            <div className="space-y-2 text-muted-foreground">
              <p><span className="font-medium text-foreground">Accepted risk:</span> an attacker may phrase an injection the model does not flag (see FOLLOWED_INJECTION). The damage is bounded because the agent can only refund what policy allows, up to $200, and only to the order owner.</p>
              <p><span className="font-medium text-foreground">Owner:</span> the support-engineering on-call reviews new failures each release and adds them to the adversarial set.</p>
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
