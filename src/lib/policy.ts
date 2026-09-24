import { ABUSE_PRIOR_REFUNDS, DEFECT_WINDOW_DAYS, HIGH_VALUE_CENTS, RETURN_WINDOW_DAYS } from './config';
import type { Order, PolicyResult, RefundReason } from './types';

const DAY_MS = 86_400_000;

// Policy v2 (SPEC §7.3, rules 1–10). Pure; first matching rule wins.
export function evaluateRefund(order: Order | null, reason: RefundReason, now: Date): PolicyResult {
  if (order === null) return { decision: 'deny', reason_code: 'ORDER_NOT_FOUND', refund_amount_cents: 0 };
  if (order.status === 'refunded') return { decision: 'deny', reason_code: 'ALREADY_REFUNDED', refund_amount_cents: 0 };
  if (order.status === 'in_transit' || order.delivered_at === null) {
    return { decision: 'deny', reason_code: 'NOT_DELIVERED', refund_amount_cents: 0 };
  }
  if (order.category === 'gift_card') {
    return { decision: 'deny', reason_code: 'GIFT_CARD_NONREFUNDABLE', refund_amount_cents: 0 };
  }
  if (order.prior_refunds >= ABUSE_PRIOR_REFUNDS) {
    return { decision: 'escalate', reason_code: 'REFUND_ABUSE_REVIEW', refund_amount_cents: order.amount_cents };
  }

  const days = Math.floor((now.getTime() - new Date(order.delivered_at).getTime()) / DAY_MS);
  const highValue = order.amount_cents > HIGH_VALUE_CENTS;

  if ((reason === 'damaged' || reason === 'wrong_item') && days <= DEFECT_WINDOW_DAYS) {
    return highValue
      ? { decision: 'escalate', reason_code: 'HIGH_VALUE_REVIEW', refund_amount_cents: order.amount_cents }
      : { decision: 'approve', reason_code: 'DEFECTIVE_ITEM', refund_amount_cents: order.amount_cents };
  }
  if (order.category === 'final_sale') {
    return { decision: 'deny', reason_code: 'FINAL_SALE', refund_amount_cents: 0 };
  }
  if (days > RETURN_WINDOW_DAYS[order.loyalty_tier]) {
    return { decision: 'deny', reason_code: 'OUTSIDE_WINDOW', refund_amount_cents: 0 };
  }
  if (highValue) {
    return { decision: 'escalate', reason_code: 'HIGH_VALUE_REVIEW', refund_amount_cents: order.amount_cents };
  }
  return { decision: 'approve', reason_code: 'WITHIN_POLICY', refund_amount_cents: order.amount_cents };
}
