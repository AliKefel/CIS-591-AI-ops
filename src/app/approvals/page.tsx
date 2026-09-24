import ApprovalButtons from '@/components/ApprovalButtons';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

interface Row {
  id: string;
  created_at: string;
  from_email: string;
  order_id_extracted: string | null;
  reason_code: string;
  refund_amount_cents: number;
  body_redacted: string;
}

export default async function ApprovalsPage() {
  const { data, error } = await getDb()
    .from('tickets')
    .select('id, created_at, from_email, order_id_extracted, reason_code, refund_amount_cents, body_redacted')
    .eq('status', 'pending_approval')
    .order('created_at', { ascending: true });
  const tickets = (data ?? []) as Row[];

  return (
    <section>
      <h1 className="mb-3 text-lg font-semibold">Approvals</h1>
      {error && <p className="text-sm text-red-600">Could not load approvals: {error.message}</p>}
      {tickets.length === 0 ? (
        <p className="text-sm text-gray-500">No tickets waiting for review.</p>
      ) : (
        <div className="overflow-x-auto rounded border border-gray-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-gray-200 bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                {['Time', 'From', 'Order', 'Reason code', 'Amount', 'Email preview', ''].map((h) => (
                  <th key={h} className="px-3 py-2 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tickets.map((t) => (
                <tr key={t.id} className="border-b border-gray-100 align-top last:border-0">
                  <td className="px-3 py-2 whitespace-nowrap">{new Date(t.created_at).toLocaleString()}</td>
                  <td className="px-3 py-2">{t.from_email}</td>
                  <td className="px-3 py-2">{t.order_id_extracted ?? '—'}</td>
                  <td className="px-3 py-2 font-mono text-xs">{t.reason_code}</td>
                  <td className="px-3 py-2">${(t.refund_amount_cents / 100).toFixed(2)}</td>
                  <td className="px-3 py-2 text-gray-600">
                    {t.body_redacted.length > 120 ? `${t.body_redacted.slice(0, 120)}…` : t.body_redacted}
                  </td>
                  <td className="px-3 py-2"><ApprovalButtons ticketId={t.id} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
