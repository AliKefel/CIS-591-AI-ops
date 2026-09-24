import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '../../../../lib/db';

export const dynamic = 'force-dynamic';

const BodySchema = z.object({ action: z.enum(['acknowledge', 'resolve']) });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const error = (status: number, code: string, message: string, details?: unknown) =>
  NextResponse.json({ error: code, message, ...(details === undefined ? {} : { details }) }, { status });

export async function POST(request: Request, ctx: RouteContext<'/api/alerts/[id]'>) {
  const { id } = await ctx.params;

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return error(400, 'VALIDATION_ERROR', 'Request body must be valid JSON');
  }
  const parsed = BodySchema.safeParse(json);
  if (!parsed.success) return error(400, 'VALIDATION_ERROR', 'Invalid request body', parsed.error.issues);
  if (!UUID.test(id)) return error(404, 'NOT_FOUND', 'Alert not found');

  try {
    const db = getDb();
    const { data: alert, error: readError } = await db.from('alerts').select('*').eq('id', id).maybeSingle();
    if (readError) throw new Error(readError.message);
    if (!alert) return error(404, 'NOT_FOUND', 'Alert not found');
    if (alert.status === 'resolved') return error(409, 'ALREADY_RESOLVED', 'Alert is already resolved');

    const fields =
      parsed.data.action === 'resolve'
        ? { status: 'resolved', resolved_at: new Date().toISOString() }
        : { status: 'acknowledged' };
    // Guard on the previous state so a concurrent resolve can't be overwritten.
    const { data: updated, error: updateError } = await db
      .from('alerts')
      .update(fields)
      .eq('id', id)
      .neq('status', 'resolved')
      .select('*')
      .maybeSingle();
    if (updateError) throw new Error(updateError.message);
    if (!updated) return error(409, 'ALREADY_RESOLVED', 'Alert is already resolved');

    return NextResponse.json({ alert: updated }, { status: 200 });
  } catch (err) {
    console.error('POST /api/alerts failed', err);
    return error(500, 'INTERNAL_ERROR', err instanceof Error ? err.message : 'Unexpected error');
  }
}
