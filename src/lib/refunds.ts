import { HIGH_VALUE_CENTS } from './config';
import type { Order } from './types';

// Least-privilege tool authorization (SPEC §7.9). Pure.
export function authorizeRefund(
  order: Order | null,
  amountCents: number,
  actor: 'agent' | 'human',
): { ok: true } | { ok: false; error: string } {
  if (order === null) return { ok: false, error: 'Order not found' };
  if (order.status !== 'delivered') return { ok: false, error: `Order is ${order.status}, not delivered` };
  if (amountCents !== order.amount_cents) return { ok: false, error: 'Refund amount must equal the order amount' };
  if (actor === 'agent' && amountCents > HIGH_VALUE_CENTS) {
    return { ok: false, error: 'Agent may not refund more than $200.00' };
  }
  return { ok: true };
}

export async function issueRefund(args: {
  order: Order;
  amountCents: number;
  actor: 'agent' | 'human';
  ticketId: string;
}): Promise<void> {
  const { order, amountCents, actor, ticketId } = args;
  const auth = authorizeRefund(order, amountCents, actor);
  if (!auth.ok) throw new Error(auth.error);

  // Loaded lazily so this module stays free of DB/env access at import time.
  const { getDb } = await import('./db');
  const db = getDb();

  // Claim the order first (only if still delivered) so two refunds can't race.
  const { data: claimed, error: claimError } = await db
    .from('orders')
    .update({ status: 'refunded' })
    .eq('id', order.id)
    .eq('status', 'delivered')
    .select('id');
  if (claimError) throw new Error(`Could not update order: ${claimError.message}`);
  if (!claimed || claimed.length === 0) throw new Error('Order is no longer refundable');

  const { error: insertError } = await db
    .from('refunds')
    .insert({ order_id: order.id, ticket_id: ticketId, amount_cents: amountCents, approved_by: actor });
  if (insertError) {
    await db.from('orders').update({ status: 'delivered' }).eq('id', order.id);
    throw new Error(`Could not record refund: ${insertError.message}`);
  }
}
