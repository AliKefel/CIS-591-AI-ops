import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '../../../../lib/db';
import { authorizeRefund, issueRefund } from '../../../../lib/refunds';
import type { Order } from '../../../../lib/types';

export const dynamic = 'force-dynamic';

const BodySchema = z.object({ action: z.enum(['approve', 'deny']) });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const error = (status: number, code: string, message: string, details?: unknown) =>
  NextResponse.json({ error: code, message, ...(details === undefined ? {} : { details }) }, { status });

export async function POST(request: Request, ctx: RouteContext<'/api/approvals/[ticketId]'>) {
  const { ticketId } = await ctx.params;

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return error(400, 'VALIDATION_ERROR', 'Request body must be valid JSON');
  }
  const parsed = BodySchema.safeParse(json);
  if (!parsed.success) return error(400, 'VALIDATION_ERROR', 'Invalid request body', parsed.error.issues);

  if (!UUID.test(ticketId)) return error(404, 'NOT_FOUND', 'Ticket not found');

  try {
    const db = getDb();
    const { data: ticket, error: ticketError } = await db.from('tickets').select('*').eq('id', ticketId).maybeSingle();
    if (ticketError) throw new Error(ticketError.message);
    if (!ticket) return error(404, 'NOT_FOUND', 'Ticket not found');
    if (ticket.status !== 'pending_approval') {
      return error(409, 'NOT_PENDING', `Ticket is ${ticket.status}, not pending_approval`);
    }

    let newStatus: 'approved_by_human' | 'denied_by_human' = 'denied_by_human';
    if (parsed.data.action === 'approve') {
      let order: Order | null = null;
      if (ticket.order_id_extracted) {
        const { data, error: orderError } = await db
          .from('orders')
          .select('*')
          .eq('id', ticket.order_id_extracted)
          .maybeSingle();
        if (orderError) throw new Error(orderError.message);
        order = (data as Order | null) ?? null;
      }
      if (!order) return error(422, 'REFUND_NOT_AUTHORIZED', 'Order not found for this ticket');

      const auth = authorizeRefund(order, order.amount_cents, 'human');
      if (!auth.ok) return error(422, 'REFUND_NOT_AUTHORIZED', auth.error);
      try {
        await issueRefund({ order, amountCents: order.amount_cents, actor: 'human', ticketId });
      } catch (err) {
        return error(422, 'REFUND_NOT_AUTHORIZED', err instanceof Error ? err.message : 'Refund failed');
      }
      newStatus = 'approved_by_human';
    }

    // Only move tickets that are still pending, so a concurrent decision can't be overwritten.
    const { data: updated, error: updateError } = await db
      .from('tickets')
      .update({ status: newStatus })
      .eq('id', ticketId)
      .eq('status', 'pending_approval')
      .select('*')
      .maybeSingle();
    if (updateError) throw new Error(updateError.message);
    if (!updated) return error(409, 'NOT_PENDING', 'Ticket was already decided');

    return NextResponse.json({ ticket: updated }, { status: 200 });
  } catch (err) {
    console.error('POST /api/approvals failed', err);
    return error(500, 'INTERNAL_ERROR', err instanceof Error ? err.message : 'Unexpected error');
  }
}
