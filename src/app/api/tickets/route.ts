import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '../../../lib/db';
import { getModelFromEnv } from '../../../lib/model';
import { processTicket } from '../../../lib/pipeline';
import type { ReasonCode } from '../../../lib/types';

export const dynamic = 'force-dynamic';

const REASON_CODES = [
  'ORDER_NOT_FOUND', 'ALREADY_REFUNDED', 'NOT_DELIVERED', 'GIFT_CARD_NONREFUNDABLE',
  'REFUND_ABUSE_REVIEW', 'DEFECTIVE_ITEM', 'HIGH_VALUE_REVIEW', 'FINAL_SALE',
  'OUTSIDE_WINDOW', 'WITHIN_POLICY', 'LLM_UNAVAILABLE', 'INJECTION_SUSPECTED',
  'NOT_A_REFUND', 'MISSING_ORDER_ID', 'IDENTITY_MISMATCH', 'REFUND_BLOCKED',
] as const satisfies readonly ReasonCode[];

const BodySchema = z.object({
  from_email: z.string().email(),
  subject: z.string().min(1).max(200),
  body: z.string().min(1).max(5000),
  dry_run: z.boolean().optional(),
  expected_decision: z.enum(['approve', 'deny', 'escalate']).optional(),
  expected_reason_code: z.enum(REASON_CODES).optional(),
});

const error = (status: number, code: string, message: string, details?: unknown) =>
  NextResponse.json({ error: code, message, ...(details === undefined ? {} : { details }) }, { status });

export async function POST(request: Request) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return error(400, 'VALIDATION_ERROR', 'Request body must be valid JSON');
  }
  const parsed = BodySchema.safeParse(json);
  if (!parsed.success) {
    return error(400, 'VALIDATION_ERROR', 'Invalid request body', parsed.error.issues);
  }
  const data = parsed.data;

  // dry_run and the expected_* labels are privileged: they require the traffic secret.
  const secretHeader = request.headers.get('x-traffic-secret');
  const privileged =
    data.dry_run !== undefined || data.expected_decision !== undefined || data.expected_reason_code !== undefined;
  const secret = process.env.CRON_SECRET;
  const hasValidSecret = secretHeader !== null && !!secret && secretHeader === secret;
  if ((privileged || secretHeader !== null) && !hasValidSecret) {
    return error(403, 'FORBIDDEN', 'A valid x-traffic-secret header is required for this request');
  }

  try {
    const { data: prompt, error: promptError } = await getDb()
      .from('prompt_versions')
      .select('id, content')
      .eq('status', 'live')
      .maybeSingle();
    if (promptError) throw new Error(promptError.message);
    if (!prompt) return error(503, 'NO_LIVE_PROMPT', 'No live prompt version is configured');

    const expected =
      data.expected_decision && data.expected_reason_code
        ? { decision: data.expected_decision, reason_code: data.expected_reason_code }
        : undefined;

    const outcome = await processTicket({
      fromEmail: data.from_email,
      subject: data.subject,
      body: data.body,
      promptVersion: prompt,
      model: getModelFromEnv(),
      persist: true,
      dryRun: data.dry_run ?? false,
      source: hasValidSecret ? 'traffic' : 'ui',
      expected,
    });

    return NextResponse.json(
      {
        ticket_id: outcome.ticket_id,
        decision: outcome.result.decision,
        reason_code: outcome.result.reason_code,
        refund_amount_cents: outcome.result.refund_amount_cents,
        reply: outcome.reply,
        status: outcome.status,
        prompt_version_id: prompt.id,
        latency_ms: outcome.latency_ms,
      },
      { status: 201 },
    );
  } catch (err) {
    console.error('POST /api/tickets failed', err);
    return error(500, 'INTERNAL_ERROR', err instanceof Error ? err.message : 'Unexpected error');
  }
}
