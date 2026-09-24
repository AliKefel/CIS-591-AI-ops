// M2: policy v2 (SPEC §7.3 rules 1–10). Written before the implementation.
import { describe, it, expect } from 'vitest';
import { evaluateRefund } from '../src/lib/policy';
import type { Order } from '../src/lib/types';

const NOW = new Date('2026-10-01T12:00:00Z');
const DAY_MS = 86_400_000;

const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY_MS).toISOString();

function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: 'ORD-9002',
    customer_name: 'Test Customer',
    customer_email: 'test@example.com',
    loyalty_tier: 'standard',
    product_name: 'Test Item',
    category: 'apparel',
    amount_cents: 5000,
    delivered_at: daysAgo(10),
    status: 'delivered',
    prior_refunds: 0,
    ...overrides,
  };
}

describe('evaluateRefund — policy v2', () => {
  it('gold member on day 45 is approved', () => {
    const order = makeOrder({ loyalty_tier: 'gold', delivered_at: daysAgo(45) });
    expect(evaluateRefund(order, 'changed_mind', NOW)).toEqual({
      decision: 'approve', reason_code: 'WITHIN_POLICY', refund_amount_cents: 5000,
    });
  });

  it('gold member on day 46 is denied', () => {
    const order = makeOrder({ loyalty_tier: 'gold', delivered_at: daysAgo(46) });
    expect(evaluateRefund(order, 'changed_mind', NOW)).toEqual({
      decision: 'deny', reason_code: 'OUTSIDE_WINDOW', refund_amount_cents: 0,
    });
  });

  it('standard member on day 31 is still denied', () => {
    const order = makeOrder({ delivered_at: daysAgo(31) });
    expect(evaluateRefund(order, 'changed_mind', NOW).reason_code).toBe('OUTSIDE_WINDOW');
  });

  it('final_sale with changed_mind is denied', () => {
    const order = makeOrder({ category: 'final_sale' });
    expect(evaluateRefund(order, 'changed_mind', NOW)).toEqual({
      decision: 'deny', reason_code: 'FINAL_SALE', refund_amount_cents: 0,
    });
  });

  it('final_sale with reason "other" is denied', () => {
    const order = makeOrder({ category: 'final_sale' });
    expect(evaluateRefund(order, 'other', NOW).reason_code).toBe('FINAL_SALE');
  });

  it('final_sale with damaged is approved as a defective item', () => {
    const order = makeOrder({ category: 'final_sale' });
    expect(evaluateRefund(order, 'damaged', NOW)).toEqual({
      decision: 'approve', reason_code: 'DEFECTIVE_ITEM', refund_amount_cents: 5000,
    });
  });

  it('damaged on day 90 is approved even though outside the standard window', () => {
    const order = makeOrder({ delivered_at: daysAgo(90) });
    expect(evaluateRefund(order, 'damaged', NOW)).toEqual({
      decision: 'approve', reason_code: 'DEFECTIVE_ITEM', refund_amount_cents: 5000,
    });
  });

  it('damaged on day 91 falls through to OUTSIDE_WINDOW', () => {
    const order = makeOrder({ delivered_at: daysAgo(91) });
    expect(evaluateRefund(order, 'damaged', NOW)).toEqual({
      decision: 'deny', reason_code: 'OUTSIDE_WINDOW', refund_amount_cents: 0,
    });
  });

  it('damaged final_sale on day 91 is denied as FINAL_SALE (rule 7 before rule 8)', () => {
    const order = makeOrder({ category: 'final_sale', delivered_at: daysAgo(91) });
    expect(evaluateRefund(order, 'damaged', NOW).reason_code).toBe('FINAL_SALE');
  });

  it('wrong_item outside the standard window is approved', () => {
    const order = makeOrder({ delivered_at: daysAgo(60) });
    expect(evaluateRefund(order, 'wrong_item', NOW)).toEqual({
      decision: 'approve', reason_code: 'DEFECTIVE_ITEM', refund_amount_cents: 5000,
    });
  });

  it('damaged over $200 is escalated with the amount', () => {
    const order = makeOrder({ amount_cents: 34900 });
    expect(evaluateRefund(order, 'damaged', NOW)).toEqual({
      decision: 'escalate', reason_code: 'HIGH_VALUE_REVIEW', refund_amount_cents: 34900,
    });
  });

  it('damaged at exactly $200 is approved', () => {
    const order = makeOrder({ amount_cents: 20000 });
    expect(evaluateRefund(order, 'damaged', NOW).reason_code).toBe('DEFECTIVE_ITEM');
  });

  it('prior_refunds 2 is approved', () => {
    const order = makeOrder({ prior_refunds: 2 });
    expect(evaluateRefund(order, 'changed_mind', NOW).decision).toBe('approve');
  });

  it('prior_refunds 3 is escalated for abuse review', () => {
    const order = makeOrder({ prior_refunds: 3 });
    expect(evaluateRefund(order, 'changed_mind', NOW)).toEqual({
      decision: 'escalate', reason_code: 'REFUND_ABUSE_REVIEW', refund_amount_cents: 5000,
    });
  });

  it('abuse review wins over a valid damaged claim (rule 5 before rule 6)', () => {
    const order = makeOrder({ prior_refunds: 4 });
    expect(evaluateRefund(order, 'damaged', NOW).reason_code).toBe('REFUND_ABUSE_REVIEW');
  });

  it('gift cards and refunded orders still win over abuse review', () => {
    expect(evaluateRefund(makeOrder({ category: 'gift_card', prior_refunds: 5 }), 'damaged', NOW).reason_code)
      .toBe('GIFT_CARD_NONREFUNDABLE');
    expect(evaluateRefund(makeOrder({ status: 'refunded', prior_refunds: 5 }), 'damaged', NOW).reason_code)
      .toBe('ALREADY_REFUNDED');
  });

  it('gold in-window order over $200 is escalated', () => {
    const order = makeOrder({ loyalty_tier: 'gold', delivered_at: daysAgo(40), amount_cents: 34900 });
    expect(evaluateRefund(order, 'changed_mind', NOW).reason_code).toBe('HIGH_VALUE_REVIEW');
  });
});
