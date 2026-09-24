import { getDb } from './db';

export type SpanName = 'redact' | 'llm.extract' | 'db.lookup_order' | 'policy.decide' | 'refund.issue';

export interface Span {
  name: SpanName;
  attempt: number;
  started_at: string;
  duration_ms: number;
  status: 'ok' | 'error';
  error_message: string | null;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
}

// Times `fn` and records it as a span; errors are recorded and re-thrown.
export async function traced<T>(
  spans: Span[],
  name: SpanName,
  fn: () => Promise<T> | T,
): Promise<T> {
  const started = new Date();
  const base = { name, attempt: 1, started_at: started.toISOString(), input_tokens: 0, output_tokens: 0, cost_usd: 0 };
  try {
    const value = await fn();
    spans.push({ ...base, duration_ms: Date.now() - started.getTime(), status: 'ok', error_message: null });
    return value;
  } catch (err) {
    spans.push({
      ...base,
      duration_ms: Date.now() - started.getTime(),
      status: 'error',
      error_message: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

export async function insertSpans(ticketId: string, spans: Span[]): Promise<void> {
  if (spans.length === 0) return;
  const rows = spans.map((s) => ({ ...s, ticket_id: ticketId }));
  const { error } = await getDb().from('spans').insert(rows);
  if (error) throw new Error(`Could not insert spans: ${error.message}`);
}
