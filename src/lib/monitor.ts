import { computeMetrics, type MetricTicket, type Metrics } from './metrics';

export type RuleName =
  | 'LIVE_ACCURACY_LOW'
  | 'LLM_ERROR_RATE_HIGH'
  | 'PII_LEAK'
  | 'P95_LATENCY_HIGH'
  | 'ESCALATION_RATE_HIGH'
  | 'INJECTION_SPIKE'
  | 'COST_HIGH';

export interface FiredRule {
  rule: RuleName;
  severity: 'warning' | 'critical';
  message: string;
  observed: number;
  threshold: number;
}

interface RuleDef {
  rule: RuleName;
  metric: keyof Metrics;
  severity: 'warning' | 'critical';
  threshold: number;
  breached: (observed: number, threshold: number) => boolean;
  message: string;
}

const above = (o: number, t: number) => o > t;
const below = (o: number, t: number) => o < t;

// SPEC §12.3. Strict comparisons: a value exactly at the threshold does not fire.
export const RULES: RuleDef[] = [
  { rule: 'LIVE_ACCURACY_LOW', metric: 'live_accuracy', severity: 'critical', threshold: 0.85, breached: below, message: 'Live accuracy fell below 85%' },
  { rule: 'LLM_ERROR_RATE_HIGH', metric: 'llm_error_rate', severity: 'critical', threshold: 0.1, breached: above, message: 'LLM error rate exceeded 10%' },
  { rule: 'PII_LEAK', metric: 'pii_leaks', severity: 'critical', threshold: 0, breached: above, message: 'Unredacted card or SSN found in stored tickets' },
  { rule: 'P95_LATENCY_HIGH', metric: 'p95_latency_ms', severity: 'warning', threshold: 8000, breached: above, message: 'p95 latency exceeded 8000 ms' },
  { rule: 'ESCALATION_RATE_HIGH', metric: 'escalation_rate', severity: 'warning', threshold: 0.4, breached: above, message: 'Escalation rate exceeded 40%' },
  { rule: 'INJECTION_SPIKE', metric: 'injection_rate', severity: 'warning', threshold: 0.2, breached: above, message: 'Injection rate exceeded 20%' },
  { rule: 'COST_HIGH', metric: 'avg_cost_usd', severity: 'warning', threshold: 0.01, breached: above, message: 'Average cost per ticket exceeded $0.01' },
];

// Pure. A null metric (below its minimum sample) skips its rule.
export function evaluateRules(metrics: Metrics): FiredRule[] {
  const fired: FiredRule[] = [];
  for (const def of RULES) {
    const observed = metrics[def.metric];
    if (observed === null) continue;
    if (def.breached(observed, def.threshold)) {
      fired.push({ rule: def.rule, severity: def.severity, message: def.message, observed, threshold: def.threshold });
    }
  }
  return fired;
}

// Human-friendly value for an alert's observed/threshold number.
export function formatMetric(rule: string, v: number): string {
  if (rule === 'P95_LATENCY_HIGH') return `${Math.round(v)} ms`;
  if (rule === 'COST_HIGH') return `$${v.toFixed(4)}`;
  if (rule === 'PII_LEAK') return String(v);
  return `${(v * 100).toFixed(1)}%`;
}

// Dedup: skip rules that already have an open or acknowledged alert.
export function filterNewRules(fired: FiredRule[], activeRules: Iterable<string>): FiredRule[] {
  const active = new Set(activeRules);
  return fired.filter((f) => !active.has(f.rule));
}

export interface AlertRow {
  id: string;
  created_at: string;
  rule: RuleName;
  severity: 'warning' | 'critical';
  message: string;
  observed: number | string;
  threshold: number | string;
  status: 'open' | 'acknowledged' | 'resolved';
  resolved_at: string | null;
}

export const TICKET_METRIC_COLUMNS =
  'decision, reason_code, expected_decision, expected_reason_code, latency_ms, llm_error, injection_detected, cost_usd, body_redacted';

export async function runMonitor(): Promise<{ metrics: Metrics; new_alerts: AlertRow[] }> {
  // Loaded lazily so rule evaluation stays free of DB/env access at import time.
  const { getDb } = await import('./db');
  const db = getDb();

  const { data: tickets, error } = await db
    .from('tickets')
    .select(TICKET_METRIC_COLUMNS)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw new Error(`Could not read tickets: ${error.message}`);

  const metrics = computeMetrics((tickets ?? []) as unknown as MetricTicket[]);
  const fired = evaluateRules(metrics);

  const { data: active, error: activeError } = await db
    .from('alerts')
    .select('rule')
    .in('status', ['open', 'acknowledged']);
  if (activeError) throw new Error(`Could not read alerts: ${activeError.message}`);

  const fresh = filterNewRules(fired, (active ?? []).map((a) => a.rule as string));
  if (fresh.length === 0) return { metrics, new_alerts: [] };

  const { data: inserted, error: insertError } = await db.from('alerts').insert(fresh).select('*');
  if (insertError) throw new Error(`Could not insert alerts: ${insertError.message}`);
  return { metrics, new_alerts: (inserted ?? []) as AlertRow[] };
}
