import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '../../../lib/db';
import { getModelFromEnv } from '../../../lib/model';
import { processTicket } from '../../../lib/pipeline';
import { findSample } from '../../../lib/samples';

export const dynamic = 'force-dynamic';

const BodySchema = z.object({ sample_id: z.string().min(1).max(20) });

const error = (status: number, code: string, message: string, details?: unknown) =>
  NextResponse.json({ error: code, message, ...(details === undefined ? {} : { details }) }, { status });

// Runs one curated sample through the real pipeline as labeled, dry-run traffic (no refunds move, no approval queue).
// Only known sample ids are accepted, so this cannot be used to send arbitrary text to the LLM.
export async function POST(request: Request) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return error(400, 'VALIDATION_ERROR', 'Request body must be valid JSON');
  }
  const parsed = BodySchema.safeParse(json);
  if (!parsed.success) return error(400, 'VALIDATION_ERROR', 'Invalid request body', parsed.error.issues);
  const sample = findSample(parsed.data.sample_id);
  if (!sample) return error(404, 'NOT_FOUND', `Unknown sample ${parsed.data.sample_id}`);

  try {
    const { data: prompt, error: promptError } = await getDb()
      .from('prompt_versions')
      .select('id, content')
      .eq('status', 'live')
      .maybeSingle();
    if (promptError) throw new Error(promptError.message);
    if (!prompt) return error(503, 'NO_LIVE_PROMPT', 'No live prompt version is configured');

    const outcome = await processTicket({
      fromEmail: sample.from_email,
      subject: sample.subject,
      body: sample.body,
      promptVersion: prompt,
      model: getModelFromEnv(),
      persist: true,
      dryRun: true,
      source: 'traffic',
      expected: sample.expected,
    });

    return NextResponse.json(
      {
        sample_id: sample.id,
        ticket_id: outcome.ticket_id,
        decision: outcome.result.decision,
        reason_code: outcome.result.reason_code,
        expected_decision: sample.expected.decision,
        expected_reason_code: sample.expected.reason_code,
        match: outcome.result.decision === sample.expected.decision && outcome.result.reason_code === sample.expected.reason_code,
        reply: outcome.reply,
        prompt_version_id: prompt.id,
        latency_ms: outcome.latency_ms,
      },
      { status: 201 },
    );
  } catch (err) {
    console.error('POST /api/simulate failed', err);
    return error(500, 'INTERNAL_ERROR', err instanceof Error ? err.message : 'Unexpected error');
  }
}
