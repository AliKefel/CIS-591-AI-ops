import type { ReasonCode } from './types';

export interface Explanation {
  stage: 'Guardrail' | 'Policy' | 'Pipeline';
  rule: string;
  summary: string;
}

// Human-readable "why" for every reason code, shown on the ticket detail page. Pure.
// Adding a ReasonCode without an entry here is a type error.
export const EXPLANATIONS: Record<ReasonCode, Explanation> = {
  LLM_UNAVAILABLE: { stage: 'Guardrail', rule: 'G1', summary: 'The LLM failed on every attempt (timeout, 5xx or unparseable output), so the system fell back to a human instead of guessing.' },
  INJECTION_SUSPECTED: { stage: 'Guardrail', rule: 'G2', summary: 'The email tried to give the AI instructions. Anything flagged as a prompt injection is escalated before policy is applied.' },
  NOT_A_REFUND: { stage: 'Guardrail', rule: 'G3', summary: 'The message is not a refund request, so a human should read it.' },
  MISSING_ORDER_ID: { stage: 'Guardrail', rule: 'G4', summary: 'No order number could be extracted, so no policy can be applied.' },
  IDENTITY_MISMATCH: { stage: 'Guardrail', rule: 'G5', summary: 'The sender address differs from the email on the order. The agent never refunds someone else\'s order.' },
  ORDER_NOT_FOUND: { stage: 'Policy', rule: 'Rule 1', summary: 'The order number does not exist.' },
  ALREADY_REFUNDED: { stage: 'Policy', rule: 'Rule 2', summary: 'This order was already refunded.' },
  NOT_DELIVERED: { stage: 'Policy', rule: 'Rule 3', summary: 'The order has not been delivered yet.' },
  GIFT_CARD_NONREFUNDABLE: { stage: 'Policy', rule: 'Rule 4', summary: 'Gift cards are never refundable.' },
  REFUND_ABUSE_REVIEW: { stage: 'Policy', rule: 'Rule 5', summary: 'The customer has 3 or more prior refunds, so a human reviews the request.' },
  DEFECTIVE_ITEM: { stage: 'Policy', rule: 'Rule 6', summary: 'Damaged or wrong item within 90 days of delivery: refunded even if final sale or outside the normal window.' },
  HIGH_VALUE_REVIEW: { stage: 'Policy', rule: 'Rule 6 / 9', summary: 'The refund is over $200, which is above what the agent is allowed to issue on its own.' },
  FINAL_SALE: { stage: 'Policy', rule: 'Rule 7', summary: 'Final-sale items cannot be returned for a change of mind.' },
  OUTSIDE_WINDOW: { stage: 'Policy', rule: 'Rule 8', summary: 'Past the return window (30 days standard, 45 days gold).' },
  WITHIN_POLICY: { stage: 'Policy', rule: 'Rule 10', summary: 'Nothing blocked the request: delivered, in window and $200 or less.' },
  REFUND_BLOCKED: { stage: 'Pipeline', rule: 'Authorization', summary: 'Policy approved the refund but the refund tool refused it (least-privilege check or a database failure), so it was escalated.' },
};

export function explainDecision(code: string): Explanation | null {
  return (EXPLANATIONS as Record<string, Explanation>)[code] ?? null;
}
