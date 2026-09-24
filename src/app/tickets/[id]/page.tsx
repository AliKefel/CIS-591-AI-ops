import Link from 'next/link';
import { notFound } from 'next/navigation';
import ApprovalButtons from '@/components/ApprovalButtons';
import DecisionBadge from '@/components/DecisionBadge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { getDb } from '@/lib/db';
import { explainDecision } from '@/lib/explain';
import { STORE_DATE } from '@/lib/config';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function Fields({ children }: { children: React.ReactNode }) {
  return <dl className="grid grid-cols-[9rem_1fr] gap-x-4 gap-y-2 text-sm [&>dt]:text-muted-foreground">{children}</dl>;
}

function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <Card size="sm">
      <CardContent>
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
        {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
      </CardContent>
    </Card>
  );
}

const STATUS_LABEL: Record<string, string> = {
  closed: 'Closed automatically',
  pending_approval: 'Waiting for a human',
  approved_by_human: 'Approved by a human',
  denied_by_human: 'Denied by a human',
};

export default async function TicketPage(props: PageProps<'/tickets/[id]'>) {
  const { id } = await props.params;
  if (!UUID.test(id)) notFound();

  const db = getDb();
  const { data: ticket } = await db.from('tickets').select('*').eq('id', id).maybeSingle();
  if (!ticket) notFound();
  const [{ data: spanRows }, { data: order }, { data: refunds }] = await Promise.all([
    db.from('spans').select('*').eq('ticket_id', id).order('started_at', { ascending: true }),
    ticket.order_id_extracted
      ? db.from('orders').select('*').eq('id', ticket.order_id_extracted).maybeSingle()
      : Promise.resolve({ data: null }),
    db.from('refunds').select('*').eq('ticket_id', id),
  ]);
  const spans = spanRows ?? [];

  const explanation = explainDecision(ticket.reason_code);
  const labeled = ticket.expected_decision !== null;
  const match = labeled && ticket.expected_decision === ticket.decision && ticket.expected_reason_code === ticket.reason_code;
  const llmAttempts = spans.filter((s) => s.name === 'llm.extract');
  const retried = llmAttempts.length > 1;
  const emailMismatch = order && order.customer_email.toLowerCase() !== String(ticket.from_email).toLowerCase();

  // Waterfall: every span positioned by its start offset from the first span.
  const t0 = spans.length ? new Date(spans[0].started_at).getTime() : 0;
  const total = Math.max(1, ...spans.map((s) => new Date(s.started_at).getTime() - t0 + s.duration_ms));
  const daysSinceDelivery = order?.delivered_at
    ? Math.floor((STORE_DATE.getTime() - new Date(order.delivered_at).getTime()) / 86_400_000)
    : null;

  return (
    <div className="space-y-4">
      <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">← Back to inbox</Link>

      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Ticket detail</h1>
        <DecisionBadge decision={ticket.decision} />
        <Badge variant="outline">{STATUS_LABEL[ticket.status] ?? ticket.status}</Badge>
        {ticket.dry_run && <Badge variant="outline">dry run</Badge>}
        <span className="ml-auto font-mono text-xs text-muted-foreground">{ticket.id}</span>
      </header>

      {ticket.status === 'pending_approval' && (
        <Alert>
          <AlertTitle>Human review required</AlertTitle>
          <AlertDescription className="space-y-3">
            <p>The agent escalated this ticket and will not refund it on its own. Approving issues a refund for the full order amount as a human (no $200 cap){order ? `: $${(order.amount_cents / 100).toFixed(2)}` : ''}.</p>
            <ApprovalButtons ticketId={ticket.id} />
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Latency" value={`${ticket.latency_ms} ms`} hint={retried ? `${llmAttempts.length} LLM attempts` : '1 LLM attempt'} />
        <Stat label="Cost" value={`$${Number(ticket.cost_usd).toFixed(5)}`} hint={`${ticket.input_tokens} in / ${ticket.output_tokens} out tokens`} />
        <Stat label="Prompt version" value={ticket.prompt_version_id} hint={`source: ${ticket.source}`} />
        <Stat label="Created" value={new Date(ticket.created_at).toLocaleDateString()} hint={new Date(ticket.created_at).toLocaleTimeString()} />
      </div>

      <Section title="Why this decision">
        <div className="space-y-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{ticket.reason_code}</code>
            {explanation && <Badge variant="outline">{explanation.stage} · {explanation.rule}</Badge>}
            <span className="text-muted-foreground">Refund amount ${(ticket.refund_amount_cents / 100).toFixed(2)}</span>
          </div>
          <p>{explanation?.summary ?? 'No explanation available for this reason code.'}</p>
          <p className="text-xs text-muted-foreground">The LLM only extracts facts. This decision came from deterministic code, so it can be unit tested and audited.</p>
        </div>
      </Section>

      <Section title="Pipeline timeline">
        <div className="space-y-2">
          {spans.map((s) => {
            const offset = ((new Date(s.started_at).getTime() - t0) / total) * 100;
            const width = Math.max(0.8, (s.duration_ms / total) * 100);
            return (
              <div key={s.id} className="grid grid-cols-[9rem_1fr_5rem] items-center gap-3 text-xs">
                <span className="truncate font-mono">{s.name}{s.name === 'llm.extract' && llmAttempts.length > 1 ? ` #${s.attempt}` : ''}</span>
                <div className="relative h-4 rounded bg-muted">
                  <div
                    className={`absolute inset-y-0 rounded ${s.status === 'error' ? 'bg-red-500' : 'bg-primary'}`}
                    style={{ left: `${Math.min(offset, 99)}%`, width: `${Math.min(width, 100 - Math.min(offset, 99))}%` }}
                    title={s.error_message ?? `${s.duration_ms} ms`}
                  />
                </div>
                <span className="text-right tabular-nums text-muted-foreground">{s.duration_ms} ms</span>
              </div>
            );
          })}
          {spans.length === 0 && <p className="text-sm text-muted-foreground">No spans recorded.</p>}
        </div>
        {retried && (
          <p className="mt-3 text-xs text-muted-foreground">
            Reliability in action: the first LLM call failed, so the pipeline waited 500 ms and retried.
            {ticket.llm_error ? ' Every attempt failed, so the ticket fell back to a human (LLM_UNAVAILABLE).' : ''}
          </p>
        )}
      </Section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Redacted email">
          <div className="space-y-1 text-sm text-muted-foreground">
            <p>From: <span className="text-foreground">{ticket.from_email}</span></p>
            <p>Subject: <span className="text-foreground">{ticket.subject}</span></p>
          </div>
          <pre className="mt-3 whitespace-pre-wrap rounded-lg bg-muted p-3 font-sans text-sm">{ticket.body_redacted}</pre>
          <div className="mt-2 flex flex-wrap gap-2">
            <Badge variant="outline" className={ticket.redaction_count > 0 ? 'border-amber-500 text-amber-500' : ''}>
              {ticket.redaction_count} PII item(s) redacted before the LLM saw it
            </Badge>
            {ticket.injection_detected && <Badge variant="outline" className="border-red-600 text-red-600">injection detected</Badge>}
          </div>
        </Section>

        <Section title="What the LLM extracted">
          {ticket.llm_error ? (
            <p className="text-sm font-medium text-destructive">LLM failed. No extraction was produced.</p>
          ) : (
            <Fields>
              <dt>intent</dt><dd>{ticket.intent}</dd>
              <dt>order_id</dt><dd>{ticket.order_id_extracted ?? 'null'}</dd>
              <dt>reason</dt><dd>{ticket.reason ?? 'null'}</dd>
              <dt>injection_detected</dt><dd>{String(ticket.injection_detected)}</dd>
            </Fields>
          )}
        </Section>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Order looked up">
          {order ? (
            <Fields>
              <dt>order</dt><dd className="font-mono">{order.id}</dd>
              <dt>customer</dt><dd>{order.customer_name} <Badge variant="outline">{order.loyalty_tier}</Badge></dd>
              <dt>order email</dt>
              <dd className={emailMismatch ? 'font-medium text-red-500' : ''}>{order.customer_email}{emailMismatch ? ' (does not match the sender)' : ''}</dd>
              <dt>product</dt><dd>{order.product_name} <span className="text-muted-foreground">({order.category})</span></dd>
              <dt>amount</dt><dd>${(order.amount_cents / 100).toFixed(2)}</dd>
              <dt>delivered</dt><dd>{daysSinceDelivery === null ? 'not delivered' : `${daysSinceDelivery} days before the store date`}</dd>
              <dt>prior refunds</dt><dd>{order.prior_refunds}</dd>
              <dt>order status</dt><dd>{order.status}</dd>
            </Fields>
          ) : (
            <p className="text-sm text-muted-foreground">{ticket.order_id_extracted ? `${ticket.order_id_extracted} was not found.` : 'No order number was extracted, so no lookup happened.'}</p>
          )}
        </Section>

        <Section title="Reply and authorization">
          <p className="text-sm">{ticket.reply}</p>
          <div className="mt-3 space-y-1 text-xs text-muted-foreground">
            <p>Least privilege: the agent may refund at most $200.00 and only the exact order amount. Anything else needs a human.</p>
            {(refunds ?? []).map((r) => (
              <p key={r.id} className="text-foreground">Refund of ${(r.amount_cents / 100).toFixed(2)} issued by {r.approved_by}.</p>
            ))}
          </div>
        </Section>
      </div>

      {labeled && (
        <Section title="Label (synthetic traffic)">
          <p className="text-sm">
            Expected: {ticket.expected_decision} / {ticket.expected_reason_code} · Actual: {ticket.decision} / {ticket.reason_code}{' '}
            <span className={match ? 'font-semibold text-green-600' : 'font-semibold text-red-600'}>{match ? '✓' : '✗'}</span>
          </p>
          <p className="mt-1 text-xs text-muted-foreground">Labeled tickets feed the live-accuracy SLO on the Ops page.</p>
        </Section>
      )}

      <Section title="Trace">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              {['Span', 'Attempt', 'Status', 'Duration (ms)', 'In tok', 'Out tok', 'Cost', 'Error'].map((h) => (
                <TableHead key={h} className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{h}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {spans.map((s) => (
              <TableRow key={s.id}>
                <TableCell className="font-mono text-xs">{s.name}</TableCell>
                <TableCell>{s.attempt}</TableCell>
                <TableCell>
                  <Badge variant="outline" className={s.status === 'error' ? 'border-red-600 text-red-600' : ''}>{s.status}</Badge>
                </TableCell>
                <TableCell className="tabular-nums">{s.duration_ms}</TableCell>
                <TableCell className="tabular-nums">{s.input_tokens}</TableCell>
                <TableCell className="tabular-nums">{s.output_tokens}</TableCell>
                <TableCell className="tabular-nums">{Number(s.cost_usd).toFixed(6)}</TableCell>
                <TableCell className="max-w-md whitespace-normal text-muted-foreground">{s.error_message ?? ''}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Section>
    </div>
  );
}
