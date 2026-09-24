import { notFound } from 'next/navigation';
import DecisionBadge from '@/components/DecisionBadge';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { getDb } from '@/lib/db';

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
  return <dl className="grid grid-cols-[10rem_1fr] gap-x-4 gap-y-2 text-sm [&>dt]:text-muted-foreground">{children}</dl>;
}

export default async function TicketPage(props: PageProps<'/tickets/[id]'>) {
  const { id } = await props.params;
  if (!UUID.test(id)) notFound();

  const db = getDb();
  const { data: ticket } = await db.from('tickets').select('*').eq('id', id).maybeSingle();
  if (!ticket) notFound();
  const { data: spanRows } = await db.from('spans').select('*').eq('ticket_id', id).order('started_at', { ascending: true });
  const spans = spanRows ?? [];

  const labeled = ticket.expected_decision !== null;
  const match = labeled && ticket.expected_decision === ticket.decision && ticket.expected_reason_code === ticket.reason_code;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold tracking-tight">Ticket</h1>
        <DecisionBadge decision={ticket.decision} />
        <Badge variant="outline">{ticket.status}</Badge>
        <span className="ml-auto font-mono text-xs text-muted-foreground">{ticket.id}</span>
      </header>

      <Section title="Redacted email">
        <div className="space-y-1 text-sm text-muted-foreground">
          <p>From: <span className="text-foreground">{ticket.from_email}</span></p>
          <p>Subject: <span className="text-foreground">{ticket.subject}</span></p>
        </div>
        <pre className="mt-3 whitespace-pre-wrap rounded-lg bg-muted p-3 font-sans text-sm">{ticket.body_redacted}</pre>
        <p className="mt-2 text-xs text-muted-foreground">Redactions: {ticket.redaction_count}</p>
      </Section>

      <Section title="Extraction">
        {ticket.llm_error ? (
          <p className="text-sm font-medium text-destructive">LLM failed</p>
        ) : (
          <Fields>
            <dt>intent</dt><dd>{ticket.intent}</dd>
            <dt>order_id</dt><dd>{ticket.order_id_extracted ?? 'null'}</dd>
            <dt>reason</dt><dd>{ticket.reason ?? 'null'}</dd>
            <dt>injection_detected</dt><dd>{String(ticket.injection_detected)}</dd>
          </Fields>
        )}
      </Section>

      <Section title="Decision">
        <Fields>
          <dt>reason_code</dt><dd className="font-mono">{ticket.reason_code}</dd>
          <dt>amount</dt><dd>${(ticket.refund_amount_cents / 100).toFixed(2)}</dd>
        </Fields>
      </Section>

      <Section title="Reply">
        <p className="text-sm">{ticket.reply}</p>
      </Section>

      {labeled && (
        <Section title="Label">
          <p className="text-sm">
            Expected: {ticket.expected_decision} / {ticket.expected_reason_code} · Actual: {ticket.decision} / {ticket.reason_code}{' '}
            <span className={match ? 'font-semibold text-green-600' : 'font-semibold text-red-600'}>{match ? '✓' : '✗'}</span>
          </p>
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
