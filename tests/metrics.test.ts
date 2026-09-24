import { describe, it, expect } from 'vitest';
import { computeMetrics, p95, type MetricTicket, type Metrics } from '../src/lib/metrics';
import { evaluateRules, filterNewRules } from '../src/lib/monitor';

const ticket = (o: Partial<MetricTicket> = {}): MetricTicket => ({
  decision: 'approve',
  reason_code: 'WITHIN_POLICY',
  expected_decision: null,
  expected_reason_code: null,
  latency_ms: 500,
  llm_error: false,
  injection_detected: false,
  cost_usd: '0.001',
  body_redacted: 'hello',
  ...o,
});

const many = (n: number, o: Partial<MetricTicket> = {}) => Array.from({ length: n }, () => ticket(o));

const empty: Metrics = {
  live_accuracy: null, p95_latency_ms: null, llm_error_rate: null, escalation_rate: null,
  injection_rate: null, avg_cost_usd: null, pii_leaks: null,
};

describe('p95 (nearest rank)', () => {
  it('uses index ceil(0.95·n) − 1 of the sorted values', () => {
    expect(p95(Array.from({ length: 20 }, (_, i) => i + 1))).toBe(19); // ceil(19) - 1 = index 18
    expect(p95(Array.from({ length: 10 }, (_, i) => (i + 1) * 100))).toBe(1000); // ceil(9.5) - 1 = index 9
  });

  it('sorts before ranking', () => {
    expect(p95([900, 100, 500, 300, 700, 200, 400, 600, 800, 1000])).toBe(1000);
  });

  it('computeMetrics reports p95 latency once there are 10 tickets', () => {
    const tickets = Array.from({ length: 10 }, (_, i) => ticket({ latency_ms: (i + 1) * 100 }));
    expect(computeMetrics(tickets).p95_latency_ms).toBe(1000);
  });
});

describe('computeMetrics — minimum sample sizes', () => {
  it('returns all-null except cost and pii for a single ticket', () => {
    const m = computeMetrics([ticket()]);
    expect(m.live_accuracy).toBeNull();
    expect(m.p95_latency_ms).toBeNull();
    expect(m.llm_error_rate).toBeNull();
    expect(m.escalation_rate).toBeNull();
    expect(m.injection_rate).toBeNull();
    expect(m.avg_cost_usd).toBeCloseTo(0.001);
    expect(m.pii_leaks).toBe(0);
  });

  it('p95 and llm_error_rate need 10; escalation and injection need 20', () => {
    const nine = computeMetrics(many(9));
    expect(nine.p95_latency_ms).toBeNull();
    expect(nine.llm_error_rate).toBeNull();
    const ten = computeMetrics(many(10));
    expect(ten.p95_latency_ms).not.toBeNull();
    expect(ten.llm_error_rate).toBe(0);
    expect(ten.escalation_rate).toBeNull();
    expect(computeMetrics(many(19)).injection_rate).toBeNull();
    expect(computeMetrics(many(20)).injection_rate).toBe(0);
  });

  it('live_accuracy needs 20 labeled tickets, not 20 tickets', () => {
    const labeled = (n: number) =>
      many(n, { expected_decision: 'approve', expected_reason_code: 'WITHIN_POLICY' });
    expect(computeMetrics([...labeled(19), ...many(30)]).live_accuracy).toBeNull();
    expect(computeMetrics(labeled(20)).live_accuracy).toBe(1);
  });

  it('is all null for an empty list', () => {
    expect(computeMetrics([])).toEqual(empty);
  });
});

describe('computeMetrics — values', () => {
  it('live accuracy requires both decision and reason_code to match', () => {
    const right = many(17, { expected_decision: 'approve', expected_reason_code: 'WITHIN_POLICY' });
    const wrongCode = many(2, { expected_decision: 'approve', expected_reason_code: 'DEFECTIVE_ITEM' });
    const wrongDecision = many(1, { expected_decision: 'deny', expected_reason_code: 'WITHIN_POLICY' });
    expect(computeMetrics([...right, ...wrongCode, ...wrongDecision]).live_accuracy).toBeCloseTo(17 / 20);
  });

  it('computes error, escalation and injection rates', () => {
    const tickets = [
      ...many(4, { llm_error: true, decision: 'escalate', injection_detected: null }),
      ...many(4, { decision: 'escalate', injection_detected: true }),
      ...many(12),
    ];
    const m = computeMetrics(tickets);
    expect(m.llm_error_rate).toBeCloseTo(4 / 20);
    expect(m.escalation_rate).toBeCloseTo(8 / 20);
    expect(m.injection_rate).toBeCloseTo(4 / 20);
  });

  it('averages cost (numeric strings from Supabase are converted)', () => {
    const m = computeMetrics([ticket({ cost_usd: '0.002' }), ticket({ cost_usd: 0.004 })]);
    expect(m.avg_cost_usd).toBeCloseTo(0.003);
  });

  it('counts tickets whose stored body still holds a card or SSN', () => {
    const m = computeMetrics([
      ticket({ body_redacted: 'card 4111 1111 1111 1111' }),
      ticket({ body_redacted: 'ssn 123-45-6789' }),
      ticket({ body_redacted: 'card [REDACTED_CARD] and ORD-1001 $129.00' }),
    ]);
    expect(m.pii_leaks).toBe(2);
  });
});

describe('evaluateRules — fires above/below threshold, not at it', () => {
  const rules = (o: Partial<Metrics>) => evaluateRules({ ...empty, ...o }).map((r) => r.rule);
  const EPS = 1e-6;

  it('LIVE_ACCURACY_LOW (critical) below 0.85', () => {
    expect(rules({ live_accuracy: 0.85 })).toEqual([]);
    expect(rules({ live_accuracy: 0.85 - EPS })).toEqual(['LIVE_ACCURACY_LOW']);
    expect(evaluateRules({ ...empty, live_accuracy: 0.5 })[0].severity).toBe('critical');
  });

  it('LLM_ERROR_RATE_HIGH (critical) above 0.10', () => {
    expect(rules({ llm_error_rate: 0.1 })).toEqual([]);
    expect(rules({ llm_error_rate: 0.1 + EPS })).toEqual(['LLM_ERROR_RATE_HIGH']);
  });

  it('PII_LEAK (critical) above 0', () => {
    expect(rules({ pii_leaks: 0 })).toEqual([]);
    expect(rules({ pii_leaks: 1 })).toEqual(['PII_LEAK']);
  });

  it('P95_LATENCY_HIGH (warning) above 8000', () => {
    expect(rules({ p95_latency_ms: 8000 })).toEqual([]);
    expect(rules({ p95_latency_ms: 8001 })).toEqual(['P95_LATENCY_HIGH']);
    expect(evaluateRules({ ...empty, p95_latency_ms: 9000 })[0].severity).toBe('warning');
  });

  it('ESCALATION_RATE_HIGH (warning) above 0.40', () => {
    expect(rules({ escalation_rate: 0.4 })).toEqual([]);
    expect(rules({ escalation_rate: 0.4 + EPS })).toEqual(['ESCALATION_RATE_HIGH']);
  });

  it('INJECTION_SPIKE (warning) above 0.20', () => {
    expect(rules({ injection_rate: 0.2 })).toEqual([]);
    expect(rules({ injection_rate: 0.2 + EPS })).toEqual(['INJECTION_SPIKE']);
  });

  it('COST_HIGH (warning) above $0.01', () => {
    expect(rules({ avg_cost_usd: 0.01 })).toEqual([]);
    expect(rules({ avg_cost_usd: 0.01 + EPS })).toEqual(['COST_HIGH']);
  });

  it('skips rules whose metric is null', () => {
    expect(evaluateRules(empty)).toEqual([]);
  });

  it('reports observed value and threshold', () => {
    expect(evaluateRules({ ...empty, p95_latency_ms: 9500 })[0]).toMatchObject({ observed: 9500, threshold: 8000 });
  });
});

describe('filterNewRules — dedup', () => {
  const fired = evaluateRules({ ...empty, pii_leaks: 2, p95_latency_ms: 9000 });

  it('drops rules that already have an open or acknowledged alert', () => {
    expect(filterNewRules(fired, ['PII_LEAK']).map((f) => f.rule)).toEqual(['P95_LATENCY_HIGH']);
  });

  it('keeps everything when nothing is active', () => {
    expect(filterNewRules(fired, [])).toHaveLength(2);
  });
});
