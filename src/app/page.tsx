import Link from 'next/link';
import DecisionBadge from '@/components/DecisionBadge';
import TicketForm from '@/components/TicketForm';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
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

const HEADERS = ['Time', 'From', 'Order', 'Decision', 'Reason code', 'Status', 'Prompt', 'Latency (ms)', 'Cost ($)', 'Source'];

export default async function InboxPage() {
  const { data, error } = await getDb()
    .from('tickets')
    .select('id, created_at, from_email, order_id_extracted, decision, reason_code, status, prompt_version_id, latency_ms, cost_usd, source')
    .order('created_at', { ascending: false })
    .limit(50);
  const tickets = (data ?? []) as Row[];

  return (
    <div className="space-y-6">
      <TicketForm />
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Recent tickets</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>Could not load tickets: {error.message}</AlertDescription>
            </Alert>
          )}
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                {HEADERS.map((h) => (
                  <TableHead key={h} className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{h}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {tickets.length === 0 && (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={HEADERS.length} className="py-10 text-center text-muted-foreground">
                    No tickets yet.
                  </TableCell>
                </TableRow>
              )}
              {tickets.map((t) => (
                <TableRow key={t.id}>
                  <TableCell>
                    <Link href={`/tickets/${t.id}`} className="font-medium text-foreground underline-offset-4 hover:underline">
                      {new Date(t.created_at).toLocaleString()}
                    </Link>
                  </TableCell>
                  <TableCell>{t.from_email}</TableCell>
                  <TableCell>{t.order_id_extracted ?? '—'}</TableCell>
                  <TableCell><DecisionBadge decision={t.decision} /></TableCell>
                  <TableCell className="font-mono text-xs">{t.reason_code}</TableCell>
                  <TableCell><Badge variant="outline">{t.status}</Badge></TableCell>
                  <TableCell><Badge variant="outline">{t.prompt_version_id}</Badge></TableCell>
                  <TableCell className="tabular-nums">{t.latency_ms}</TableCell>
                  <TableCell className="tabular-nums">{Number(t.cost_usd).toFixed(6)}</TableCell>
                  <TableCell className="text-muted-foreground">{t.source}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
