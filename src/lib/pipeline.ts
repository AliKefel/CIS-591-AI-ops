import { MODEL_PRICING, STORE_DATE } from './config';
import { decideTicket } from './decide';
import { getDb } from './db';
import { extractTicket, formatUserMessage, type AttemptRecord } from './extract';
import { ChaosModel, type ChaosMode, type ModelProvider } from './model';
import { redactPII } from './redact';
import { buildReply } from './replies';
import { issueRefund } from './refunds';
import { insertSpans, traced, type Span } from './trace';
import type { Decision, Extraction, Order, PolicyResult, ReasonCode } from './types';

export type TicketStatus = 'closed' | 'pending_approval';

export interface TicketOutcome {
  ticket_id: string | null; // null if not persisted
  redaction_count: number;
  extraction: Extraction | null;
  result: PolicyResult;
  reply: string;
  status: TicketStatus;
  latency_ms: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  spans: Span[];
}

function costUsd(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = MODEL_PRICING[model];
  if (!pricing) {
    if (model !== 'heuristic' && model !== 'mock') console.warn(`No pricing for model "${model}"; cost recorded as 0`);
    return 0;
  }
  return (inputTokens * pricing.inputPerMTok + outputTokens * pricing.outputPerMTok) / 1_000_000;
}

function attemptSpan(a: AttemptRecord, model: string): Span {
  return {
    name: 'llm.extract',
    attempt: a.attempt,
    started_at: a.started_at,
    duration_ms: a.duration_ms,
    status: a.status,
    error_message: a.error ?? null,
    input_tokens: a.input_tokens,
    output_tokens: a.output_tokens,
    cost_usd: costUsd(model, a.input_tokens, a.output_tokens),
  };
}

async function lookupOrder(orderId: string): Promise<Order | null> {
  const { data, error } = await getDb().from('orders').select('*').eq('id', orderId).maybeSingle();
  if (error) throw new Error(`Order lookup failed: ${error.message}`);
  return (data as Order | null) ?? null;
}

async function readChaosMode(): Promise<ChaosMode> {
  const { data } = await getDb().from('chaos_config').select('mode').eq('id', 1).maybeSingle();
  const mode = data?.mode;
  return mode === 'latency' || mode === 'errors' ? mode : 'none';
}

export async function processTicket(input: {
  fromEmail: string;
  subject: string;
  body: string;
  promptVersion: { id: string; content: string };
  model: ModelProvider;
  persist: boolean; // false for evals
  dryRun: boolean; // true = no refunds, no approval queue
  source: 'ui' | 'traffic' | 'eval';
  expected?: { decision: Decision; reason_code: ReasonCode };
  now?: Date; // defaults to STORE_DATE
}): Promise<TicketOutcome> {
  const { fromEmail, subject, body, promptVersion, persist, dryRun, source, expected } = input;
  const now = input.now ?? STORE_DATE;
  const startedMs = Date.now();
  const spans: Span[] = [];
  const ticketId = persist ? crypto.randomUUID() : null;

  // Evals never apply chaos.
  let model = input.model;
  if (persist) {
    const mode = await readChaosMode();
    if (mode !== 'none') model = new ChaosModel(model, mode);
  }

  // 1. redact (before the LLM call and before anything is stored)
  const redacted = await traced(spans, 'redact', () => redactPII(body));

  // 2. llm.extract: one span per attempt
  const { extraction, attempts } = await extractTicket({
    model,
    system: promptVersion.content,
    user: formatUserMessage(fromEmail, subject, redacted.text),
  });
  for (const a of attempts) spans.push(attemptSpan(a, model.name));
  const inputTokens = attempts.reduce((n, a) => n + a.input_tokens, 0);
  const outputTokens = attempts.reduce((n, a) => n + a.output_tokens, 0);
  const cost = costUsd(model.name, inputTokens, outputTokens);

  // 3. db.lookup_order
  const order = extraction?.order_id
    ? await traced(spans, 'db.lookup_order', () => lookupOrder(extraction.order_id as string))
    : null;

  // 4. policy.decide
  let result = await traced(spans, 'policy.decide', () => decideTicket({ extraction, order, fromEmail, now }));

  const statusFor = (r: PolicyResult): TicketStatus =>
    r.decision === 'escalate' && !dryRun ? 'pending_approval' : 'closed';

  const buildRow = (r: PolicyResult, reply: string, latencyMs: number) => ({
    id: ticketId,
    source,
    dry_run: dryRun,
    from_email: fromEmail,
    subject,
    body_redacted: redacted.text,
    redaction_count: redacted.count,
    prompt_version_id: promptVersion.id,
    intent: extraction?.intent ?? null,
    order_id_extracted: extraction?.order_id ?? null,
    reason: extraction?.reason ?? null,
    injection_detected: extraction?.injection_detected ?? null,
    llm_error: extraction === null,
    decision: r.decision,
    reason_code: r.reason_code,
    refund_amount_cents: r.refund_amount_cents,
    reply,
    status: statusFor(r),
    latency_ms: latencyMs,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cost_usd: cost,
    expected_decision: expected?.decision ?? null,
    expected_reason_code: expected?.reason_code ?? null,
  });

  // 5. refund.issue. The refunds table references tickets, so the ticket row is written first
  // (provisionally) and finalized below if the refund fails.
  const willRefund = result.decision === 'approve' && !dryRun && persist && order !== null;
  let ticketInserted = false;
  if (willRefund) {
    const { error } = await getDb().from('tickets').insert(buildRow(result, buildReply(result, order), 0));
    if (error) throw new Error(`Could not insert ticket: ${error.message}`);
    ticketInserted = true;
    try {
      await traced(spans, 'refund.issue', () =>
        issueRefund({ order, amountCents: result.refund_amount_cents, actor: 'agent', ticketId: ticketId as string }),
      );
    } catch {
      result = { decision: 'escalate', reason_code: 'REFUND_BLOCKED', refund_amount_cents: result.refund_amount_cents };
    }
  }

  // 6. reply
  const reply = buildReply(result, order);
  const latencyMs = Date.now() - startedMs;
  const status = statusFor(result);

  if (persist && ticketId) {
    const db = getDb();
    const row = buildRow(result, reply, latencyMs);
    const { error } = ticketInserted
      ? await db.from('tickets').update(row).eq('id', ticketId)
      : await db.from('tickets').insert(row);
    if (error) throw new Error(`Could not save ticket: ${error.message}`);
    await insertSpans(ticketId, spans);
  }

  return {
    ticket_id: ticketId,
    redaction_count: redacted.count,
    extraction,
    result,
    reply,
    status,
    latency_ms: latencyMs,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cost_usd: cost,
    spans,
  };
}
