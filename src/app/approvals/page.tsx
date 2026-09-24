import ApprovalButtons from '@/components/ApprovalButtons';
import ClickableRow from '@/components/ClickableRow';
import PageHeader from '@/components/PageHeader';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
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

const HEADERS = ['Time', 'From', 'Order', 'Reason code', 'Amount', 'Email preview', ''];

export default async function ApprovalsPage() {
  const { data, error } = await getDb()
    .from('tickets')
    .select('id, created_at, from_email, order_id_extracted, reason_code, refund_amount_cents, body_redacted')
    .eq('status', 'pending_approval')
    .order('created_at', { ascending: true });
  const tickets = (data ?? []) as Row[];

  return (
    <div>
    <PageHeader title="Approvals" description="Escalated tickets waiting for a human decision." />
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Pending review</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>Could not load approvals: {error.message}</AlertDescription>
          </Alert>
        )}
        {tickets.length === 0 ? (
          <Alert>
            <AlertDescription>No tickets waiting for review.</AlertDescription>
          </Alert>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                {HEADERS.map((h, i) => (
                  <TableHead key={i} className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{h}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {tickets.map((t) => (
                <ClickableRow key={t.id} href={`/tickets/${t.id}`} className="align-top">
                  <TableCell>{new Date(t.created_at).toLocaleString()}</TableCell>
                  <TableCell>{t.from_email}</TableCell>
                  <TableCell>{t.order_id_extracted ?? '—'}</TableCell>
                  <TableCell className="font-mono text-xs">{t.reason_code}</TableCell>
                  <TableCell className="tabular-nums">${(t.refund_amount_cents / 100).toFixed(2)}</TableCell>
                  <TableCell className="max-w-xs whitespace-normal text-muted-foreground">
                    {t.body_redacted.length > 120 ? `${t.body_redacted.slice(0, 120)}…` : t.body_redacted}
                  </TableCell>
                  <TableCell><ApprovalButtons ticketId={t.id} /></TableCell>
                </ClickableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
    </div>
  );
}
