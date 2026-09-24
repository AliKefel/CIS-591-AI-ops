import { describe, it, expect } from 'vitest';
import { EXPLANATIONS, explainDecision } from '../src/lib/explain';

describe('explainDecision', () => {
  it('describes guardrail, policy and pipeline codes', () => {
    expect(explainDecision('INJECTION_SUSPECTED')?.stage).toBe('Guardrail');
    expect(explainDecision('WITHIN_POLICY')?.stage).toBe('Policy');
    expect(explainDecision('REFUND_BLOCKED')?.stage).toBe('Pipeline');
  });

  it('returns null for an unknown code instead of throwing', () => {
    expect(explainDecision('NOPE')).toBeNull();
  });

  it('every explanation has a rule and a sentence', () => {
    for (const e of Object.values(EXPLANATIONS)) {
      expect(e.rule.length).toBeGreaterThan(0);
      expect(e.summary.length).toBeGreaterThan(10);
    }
  });
});
