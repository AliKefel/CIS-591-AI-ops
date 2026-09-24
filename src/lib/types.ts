export type LoyaltyTier = 'standard' | 'gold';
export type Category = 'apparel' | 'gear' | 'electronics' | 'final_sale' | 'gift_card';
export type OrderStatus = 'in_transit' | 'delivered' | 'refunded';
export type RefundReason = 'damaged' | 'wrong_item' | 'changed_mind' | 'other';
export type Decision = 'approve' | 'deny' | 'escalate';

export type ReasonCode =
  // policy (evaluateRefund)
  | 'ORDER_NOT_FOUND' | 'ALREADY_REFUNDED' | 'NOT_DELIVERED' | 'GIFT_CARD_NONREFUNDABLE'
  | 'REFUND_ABUSE_REVIEW' | 'DEFECTIVE_ITEM' | 'HIGH_VALUE_REVIEW' | 'FINAL_SALE'
  | 'OUTSIDE_WINDOW' | 'WITHIN_POLICY'
  // guardrails (decideTicket)
  | 'LLM_UNAVAILABLE' | 'INJECTION_SUSPECTED' | 'NOT_A_REFUND' | 'MISSING_ORDER_ID'
  | 'IDENTITY_MISMATCH'
  // pipeline
  | 'REFUND_BLOCKED';

export interface Order {
  id: string;
  customer_name: string;
  customer_email: string;
  loyalty_tier: LoyaltyTier;
  product_name: string;
  category: Category;
  amount_cents: number;
  delivered_at: string | null; // ISO timestamp; null when in_transit
  status: OrderStatus;
  prior_refunds: number;
}

export interface PolicyResult {
  decision: Decision;
  reason_code: ReasonCode;
  refund_amount_cents: number; // deny → 0; approve/escalate → order amount (0 if no order)
}

export interface Extraction {
  intent: 'refund_request' | 'other';
  order_id: string | null;
  reason: RefundReason | null;
  injection_detected: boolean;
}
