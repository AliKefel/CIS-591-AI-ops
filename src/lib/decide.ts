import { evaluateRefund } from './policy';
import type { Extraction, Order, PolicyResult } from './types';

const escalate = (reason_code: PolicyResult['reason_code']): PolicyResult => ({
  decision: 'escalate',
  reason_code,
  refund_amount_cents: 0,
});

// Guardrails G1–G6 (SPEC §7.5): anything suspicious goes to a human before policy runs.
export function decideTicket(input: {
  extraction: Extraction | null;
  order: Order | null;
  fromEmail: string;
  now: Date;
}): PolicyResult {
  const { extraction, order, fromEmail, now } = input;
  if (extraction === null) return escalate('LLM_UNAVAILABLE');
  if (extraction.injection_detected) return escalate('INJECTION_SUSPECTED');
  if (extraction.intent === 'other') return escalate('NOT_A_REFUND');
  if (extraction.order_id === null) return escalate('MISSING_ORDER_ID');
  if (order !== null && order.customer_email.trim().toLowerCase() !== fromEmail.trim().toLowerCase()) {
    return escalate('IDENTITY_MISMATCH');
  }
  return evaluateRefund(order, extraction.reason ?? 'other', now);
}
