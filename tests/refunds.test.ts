import { describe, it, expect } from 'vitest';
import { authorizeRefund } from '../src/lib/refunds';
import type { Order } from '../src/lib/types';

const order = (overrides: Partial<Order> = {}): Order => ({
  id: 'ORD-9004',
  customer_name: 'Test Customer',
  customer_email: 'test@example.com',
  loyalty_tier: 'standard',
  product_name: 'Test Item',
  category: 'gear',
  amount_cents: 5000,
  delivered_at: '2026-09-21T12:00:00Z',
  status: 'delivered',
  prior_refunds: 0,
  ...overrides,
});

describe('authorizeRefund', () => {
  it('allows the agent to refund $200.00 or less', () => {
    expect(authorizeRefund(order({ amount_cents: 20000 }), 20000, 'agent')).toEqual({ ok: true });
  });

  it('denies the agent above $200.00', () => {
    const result = authorizeRefund(order({ amount_cents: 20001 }), 20001, 'agent');
    expect(result.ok).toBe(false);
  });

  it('allows a human to refund above $200.00', () => {
    expect(authorizeRefund(order({ amount_cents: 34900 }), 34900, 'human')).toEqual({ ok: true });
  });

  it('denies an amount that differs from the order amount', () => {
    expect(authorizeRefund(order(), 4999, 'human').ok).toBe(false);
    expect(authorizeRefund(order(), 5001, 'agent').ok).toBe(false);
  });

  it('denies an already refunded order', () => {
    expect(authorizeRefund(order({ status: 'refunded' }), 5000, 'human').ok).toBe(false);
  });

  it('denies an in-transit order', () => {
    expect(authorizeRefund(order({ status: 'in_transit', delivered_at: null }), 5000, 'human').ok).toBe(false);
  });

  it('denies a missing order', () => {
    expect(authorizeRefund(null, 5000, 'human').ok).toBe(false);
  });
});
