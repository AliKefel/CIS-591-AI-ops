import { containsPII } from './redact';

// The fields of a ticket row that metrics need. `cost_usd` may be a string (Supabase numeric).
export interface MetricTicket {
  decision: 'approve' | 'deny' | 'escalate';
  reason_code: string;
  expected_decision: string | null;
  expected_reason_code: string | null;
  latency_ms: number;
  llm_error: boolean;
  injection_detected: boolean | null;
  cost_usd: number | string;
  body_redacted: string;
}

export interface Metrics {
  live_accuracy: number | null;
  p95_latency_ms: number | null;
  llm_error_rate: number | null;
  escalation_rate: number | null;
  injection_rate: number | null;
  avg_cost_usd: number | null;
  pii_leaks: number | null;
}

// Minimum sample size before a metric is reported (SPEC §12.1).
export const MIN_SAMPLE = {
  live_accuracy: 20, // labeled tickets
  p95_latency_ms: 10,
  llm_error_rate: 10,
  escalation_rate: 20,
  injection_rate: 20,
  avg_cost_usd: 1,
  pii_leaks: 1,
} as const;

export function p95(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(0.95 * sorted.length) - 1];
}

export function computeMetrics(tickets: MetricTicket[]): Metrics {
  const n = tickets.length;
  const labeled = tickets.filter((t) => t.expected_decision !== null && t.expected_reason_code !== null);
  const correct = labeled.filter(
    (t) => t.decision === t.expected_decision && t.reason_code === t.expected_reason_code,
  ).length;
  const ratio = (count: number) => count / n;

  return {
    live_accuracy: labeled.length >= MIN_SAMPLE.live_accuracy ? correct / labeled.length : null,
    p95_latency_ms: n >= MIN_SAMPLE.p95_latency_ms ? p95(tickets.map((t) => t.latency_ms)) : null,
    llm_error_rate: n >= MIN_SAMPLE.llm_error_rate ? ratio(tickets.filter((t) => t.llm_error).length) : null,
    escalation_rate: n >= MIN_SAMPLE.escalation_rate ? ratio(tickets.filter((t) => t.decision === 'escalate').length) : null,
    injection_rate: n >= MIN_SAMPLE.injection_rate ? ratio(tickets.filter((t) => t.injection_detected === true).length) : null,
    avg_cost_usd: n >= MIN_SAMPLE.avg_cost_usd ? tickets.reduce((sum, t) => sum + Number(t.cost_usd), 0) / n : null,
    pii_leaks: n >= MIN_SAMPLE.pii_leaks ? tickets.filter((t) => containsPII(t.body_redacted)).length : null,
  };
}
