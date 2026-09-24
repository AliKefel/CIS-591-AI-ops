import { notFound } from 'next/navigation';
import DecisionBadge from '@/components/DecisionBadge';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded border border-gray-200 bg-white p-4">
      <h2 className="mb-2 text-sm font-semibold uppercase text-gray-500">{title}</h2>
      {children}
    </section>
  );
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
      <header className="flex items-center gap-3">
        <h1 className="text-lg font-semibold">Ticket</h1>
        <DecisionBadge decision={ticket.decision} />
        <span className="text-sm text-gray-600">{ticket.status}</span>
        <span className="ml-auto font-mono text-xs text-gray-400">{ticket.id}</span>
      </header>

      <Section title="Redacted email">
        <p className="text-sm text-gray-600">From: {ticket.from_email}</p>
        <p className="text-sm text-gray-600">Subject: {ticket.subject}</p>
        <pre className="mt-2 whitespace-pre-wrap rounded bg-gray-50 p-3 text-sm">{ticket.body_redacted}</pre>
        <p className="mt-1 text-xs text-gray-500">Redactions: {ticket.redaction_count}</p>
      </Section>

      <Section title="Extraction">
        {ticket.llm_error ? (
          <p className="text-sm text-red-600">LLM failed</p>
        ) : (
          <dl className="grid grid-cols-[10rem_1fr] gap-1 text-sm">
            <dt className="text-gray-500">intent</dt><dd>{ticket.intent}</dd>
            <dt className="text-gray-500">order_id</dt><dd>{ticket.order_id_extracted ?? 'null'}</dd>
            <dt className="text-gray-500">reason</dt><dd>{ticket.reason ?? 'null'}</dd>
            <dt className="text-gray-500">injection_detected</dt><dd>{String(ticket.injection_detected)}</dd>
          </dl>
        )}
      </Section>

      <Section title="Decision">
        <dl className="grid grid-cols-[10rem_1fr] gap-1 text-sm">
          <dt className="text-gray-500">reason_code</dt><dd className="font-mono">{ticket.reason_code}</dd>
          <dt className="text-gray-500">amount</dt><dd>${(ticket.refund_amount_cents / 100).toFixed(2)}</dd>
        </dl>
      </Section>

      <Section title="Reply">
        <p className="text-sm">{ticket.reply}</p>
      </Section>

      {labeled && (
        <Section title="Label">
          <p className="text-sm">
            Expected: {ticket.expected_decision} / {ticket.expected_reason_code} · Actual: {ticket.decision} / {ticket.reason_code}{' '}
            <span className={match ? 'text-green-600' : 'text-red-600'}>{match ? '✓' : '✗'}</span>
          </p>
        </Section>
      )}

      <Section title="Trace">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-gray-200 text-xs uppercase text-gray-500">
              <tr>
                {['Span', 'Attempt', 'Status', 'Duration (ms)', 'In tok', 'Out tok', 'Cost', 'Error'].map((h) => (
                  <th key={h} className="px-3 py-2 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {spans.map((s) => (
                <tr key={s.id} className="border-b border-gray-100 last:border-0">
                  <td className="px-3 py-2 font-mono text-xs">{s.name}</td>
                  <td className="px-3 py-2">{s.attempt}</td>
                  <td className={`px-3 py-2 ${s.status === 'error' ? 'text-red-600' : ''}`}>{s.status}</td>
                  <td className="px-3 py-2">{s.duration_ms}</td>
                  <td className="px-3 py-2">{s.input_tokens}</td>
                  <td className="px-3 py-2">{s.output_tokens}</td>
                  <td className="px-3 py-2">{Number(s.cost_usd).toFixed(6)}</td>
                  <td className="px-3 py-2 text-gray-600">{s.error_message ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}
