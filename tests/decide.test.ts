import { describe, it, expect } from 'vitest';
import { decideTicket } from '../src/lib/decide';
import type { Extraction, Order } from '../src/lib/types';

const NOW = new Date('2026-10-01T12:00:00Z');

const order: Order = {
  id: 'ORD-9003',
  customer_name: 'Test Customer',
  customer_email: 'test@example.com',
  loyalty_tier: 'standard',
  product_name: 'Test Item',
  category: 'apparel',
  amount_cents: 5000,
  delivered_at: '2026-09-21T12:00:00Z',
  status: 'delivered',
  prior_refunds: 0,
};

const extraction = (overrides: Partial<Extraction> = {}): Extraction => ({
  intent: 'refund_request',
  order_id: 'ORD-9003',
  reason: 'changed_mind',
  injection_detected: false,
  ...overrides,
});

const decide = (e: Extraction | null, o: Order | null = order, fromEmail = 'test@example.com') =>
  decideTicket({ extraction: e, order: o, fromEmail, now: NOW });

describe('decideTicket', () => {
  it('G1: null extraction escalates as LLM_UNAVAILABLE', () => {
    expect(decide(null)).toEqual({ decision: 'escalate', reason_code: 'LLM_UNAVAILABLE', refund_amount_cents: 0 });
  });

  it('G2: injection escalates as INJECTION_SUSPECTED', () => {
    expect(decide(extraction({ injection_detected: true }))).toEqual({
      decision: 'escalate', reason_code: 'INJECTION_SUSPECTED', refund_amount_cents: 0,
    });
  });

  it('G3: non-refund intent escalates as NOT_A_REFUND', () => {
    expect(decide(extraction({ intent: 'other' })).reason_code).toBe('NOT_A_REFUND');
  });

  it('G4: missing order id escalates as MISSING_ORDER_ID', () => {
    expect(decide(extraction({ order_id: null }), null).reason_code).toBe('MISSING_ORDER_ID');
  });

  it('G5: sender that differs from the order email escalates as IDENTITY_MISMATCH', () => {
    expect(decide(extraction(), order, 'someone.else@example.net')).toEqual({
      decision: 'escalate', reason_code: 'IDENTITY_MISMATCH', refund_amount_cents: 0,
    });
  });

  it('G5: email comparison ignores case and surrounding whitespace', () => {
    expect(decide(extraction(), order, '  TEST@Example.COM ').decision).toBe('approve');
  });

  it('G6: falls through to the refund policy', () => {
    expect(decide(extraction())).toEqual({ decision: 'approve', reason_code: 'WITHIN_POLICY', refund_amount_cents: 5000 });
  });

  it('G6: unknown order id is denied by policy, not escalated', () => {
    expect(decide(extraction({ order_id: 'ORD-0000' }), null).reason_code).toBe('ORDER_NOT_FOUND');
  });

  it('G6: a null reason is treated as "other"', () => {
    expect(decide(extraction({ reason: null })).reason_code).toBe('WITHIN_POLICY');
  });

  it('guardrails run in order: injection wins over identity mismatch', () => {
    expect(decide(extraction({ injection_detected: true }), order, 'x@y.com').reason_code).toBe('INJECTION_SUSPECTED');
  });
});
