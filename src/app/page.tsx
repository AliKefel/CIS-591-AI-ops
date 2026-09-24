import Link from 'next/link';
import DecisionBadge from '@/components/DecisionBadge';
import TicketForm from '@/components/TicketForm';
import { getDb } from '@/lib/db';
import type { Decision } from '@/lib/types';

export const dynamic = 'force-dynamic';

interface Row {
  id: string;
  created_at: string;
  from_email: string;
  order_id_extracted: string | null;
  decision: Decision;
  reason_code: string;
  status: string;
  prompt_version_id: string;
  latency_ms: number;
  cost_usd: string;
  source: string;
}

export default async function InboxPage() {
  const { data, error } = await getDb()
    .from('tickets')
    .select('id, created_at, from_email, order_id_extracted, decision, reason_code, status, prompt_version_id, latency_ms, cost_usd, source')
    .order('created_at', { ascending: false })
    .limit(50);
  const tickets = (data ?? []) as Row[];

  return (
    <div className="space-y-8">
      <TicketForm />
      <section>
        <h2 className="mb-3 text-lg font-semibold">Recent tickets</h2>
        {error && <p className="text-sm text-red-600">Could not load tickets: {error.message}</p>}
        <div className="overflow-x-auto rounded border border-gray-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-gray-200 bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                {['Time', 'From', 'Order', 'Decision', 'Reason code', 'Status', 'Prompt', 'Latency (ms)', 'Cost ($)', 'Source'].map((h) => (
                  <th key={h} className="px-3 py-2 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tickets.length === 0 && (
                <tr><td colSpan={10} className="px-3 py-6 text-center text-gray-500">No tickets yet.</td></tr>
              )}
              {tickets.map((t) => (
                <tr key={t.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                  <td className="px-3 py-2 whitespace-nowrap">
                    <Link href={`/tickets/${t.id}`} className="text-blue-700 hover:underline">
                      {new Date(t.created_at).toLocaleString()}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{t.from_email}</td>
                  <td className="px-3 py-2">{t.order_id_extracted ?? '—'}</td>
                  <td className="px-3 py-2"><DecisionBadge decision={t.decision} /></td>
                  <td className="px-3 py-2 font-mono text-xs">{t.reason_code}</td>
                  <td className="px-3 py-2">{t.status}</td>
                  <td className="px-3 py-2">{t.prompt_version_id}</td>
                  <td className="px-3 py-2">{t.latency_ms}</td>
                  <td className="px-3 py-2">{Number(t.cost_usd).toFixed(6)}</td>
                  <td className="px-3 py-2">{t.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
