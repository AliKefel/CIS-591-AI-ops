// Acceptance tests for the BASE refund policy (SPEC §7.3, rules B1–B7).
// Do not edit. These must keep passing after the M2 policy change.
import { describe, it, expect } from 'vitest';
import { evaluateRefund } from '../../src/lib/policy';
import type { Order } from '../../src/lib/types';

const NOW = new Date('2026-10-01T12:00:00Z');
const DAY_MS = 86_400_000;

function daysAgo(days: number, now: Date = NOW): string {
  return new Date(now.getTime() - days * DAY_MS).toISOString();
}

function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: 'ORD-9001',
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

describe('evaluateRefund — base policy', () => {
  it('B1: denies when the order does not exist', () => {
    expect(evaluateRefund(null, 'changed_mind', NOW)).toEqual({
      decision: 'deny',
      reason_code: 'ORDER_NOT_FOUND',
      refund_amount_cents: 0,
    });
  });

  it('B2: denies an order that was already refunded', () => {
    const order = makeOrder({ status: 'refunded' });
    expect(evaluateRefund(order, 'changed_mind', NOW)).toEqual({
      decision: 'deny',
      reason_code: 'ALREADY_REFUNDED',
      refund_amount_cents: 0,
    });
  });

  it('B3: denies an order that has not been delivered (delivered_at is null)', () => {
    const order = makeOrder({ status: 'in_transit', delivered_at: null });
    expect(evaluateRefund(order, 'changed_mind', NOW)).toEqual({
      decision: 'deny',
      reason_code: 'NOT_DELIVERED',
      refund_amount_cents: 0,
    });
  });

  it('B4: denies gift cards', () => {
    const order = makeOrder({ category: 'gift_card' });
    expect(evaluateRefund(order, 'changed_mind', NOW)).toEqual({
      decision: 'deny',
      reason_code: 'GIFT_CARD_NONREFUNDABLE',
      refund_amount_cents: 0,
    });
  });

  it('B5: approves a standard order on day 30 (window is inclusive)', () => {
    const order = makeOrder({ delivered_at: daysAgo(30) });
    expect(evaluateRefund(order, 'changed_mind', NOW)).toEqual({
      decision: 'approve',
      reason_code: 'WITHIN_POLICY',
      refund_amount_cents: 5000,
    });
  });

  it('B5: denies a standard order on day 31', () => {
    const order = makeOrder({ delivered_at: daysAgo(31) });
    expect(evaluateRefund(order, 'changed_mind', NOW)).toEqual({
      decision: 'deny',
      reason_code: 'OUTSIDE_WINDOW',
      refund_amount_cents: 0,
    });
  });

  it('B6: approves exactly $200.00 without human review', () => {
    const order = makeOrder({ amount_cents: 20000 });
    expect(evaluateRefund(order, 'changed_mind', NOW)).toEqual({
      decision: 'approve',
      reason_code: 'WITHIN_POLICY',
      refund_amount_cents: 20000,
    });
  });

  it('B6: escalates orders over $200.00 and carries the amount for the reviewer', () => {
    const order = makeOrder({ amount_cents: 20001 });
    expect(evaluateRefund(order, 'changed_mind', NOW)).toEqual({
      decision: 'escalate',
      reason_code: 'HIGH_VALUE_REVIEW',
      refund_amount_cents: 20001,
    });
  });

  it('B7: approves a normal in-window order for the full amount', () => {
    const order = makeOrder({ amount_cents: 12900 });
    expect(evaluateRefund(order, 'changed_mind', NOW)).toEqual({
      decision: 'approve',
      reason_code: 'WITHIN_POLICY',
      refund_amount_cents: 12900,
    });
  });

  it('treats reason "other" like "changed_mind"', () => {
    const order = makeOrder();
    expect(evaluateRefund(order, 'other', NOW).reason_code).toBe('WITHIN_POLICY');
  });

  it('applies rules in order: already refunded wins over gift card', () => {
    const order = makeOrder({ status: 'refunded', category: 'gift_card' });
    expect(evaluateRefund(order, 'changed_mind', NOW).reason_code).toBe('ALREADY_REFUNDED');
  });

  it('uses the injected clock, not the system clock', () => {
    const order = makeOrder({ delivered_at: '2026-09-01T12:00:00Z' });
    expect(evaluateRefund(order, 'changed_mind', new Date('2026-09-05T12:00:00Z')).decision).toBe('approve');
    expect(evaluateRefund(order, 'changed_mind', new Date('2026-12-01T12:00:00Z')).decision).toBe('deny');
  });

  it('does not mutate the order', () => {
    const order = Object.freeze(makeOrder());
    expect(() => evaluateRefund(order, 'changed_mind', NOW)).not.toThrow();
  });
});
