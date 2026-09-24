export const STORE_DATE = new Date('2026-10-01T12:00:00Z');
export const HIGH_VALUE_CENTS = 20000;          // > $200.00 needs a human
export const RETURN_WINDOW_DAYS = { standard: 30, gold: 45 } as const;
export const DEFECT_WINDOW_DAYS = 90;
export const ABUSE_PRIOR_REFUNDS = 3;
export const LLM_TIMEOUT_MS = 10000;
export const LLM_MAX_ATTEMPTS = 2;
export const LLM_BACKOFF_MS = 500;
export const MODEL_PRICING: Record<string, { inputPerMTok: number; outputPerMTok: number }> = {
  'claude-haiku-4-5-20251001': { inputPerMTok: 1.0, outputPerMTok: 5.0 },
};
export const GATES = { golden: 0.9, adversarial: 0.9 } as const;
