import { NextResponse } from 'next/server';
import { z } from 'zod';
import { retireVersion } from '../../../../../lib/releases';

export const dynamic = 'force-dynamic';

const BodySchema = z.object({ reason: z.string().trim().min(5) });

export async function POST(request: Request, ctx: RouteContext<'/api/prompt-versions/[id]/retire'>) {
  const { id } = await ctx.params;

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: 'VALIDATION_ERROR', message: 'Request body must be valid JSON' }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'VALIDATION_ERROR', message: 'reason must be at least 5 characters', details: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    const result = await retireVersion(id, parsed.data.reason);
    if (!result.ok) {
      return NextResponse.json({ error: result.error, message: result.message, details: result.details }, { status: result.status });
    }
    return NextResponse.json(result.data, { status: 200 });
  } catch (err) {
    console.error('retire failed', err);
    return NextResponse.json(
      { error: 'INTERNAL_ERROR', message: err instanceof Error ? err.message : 'Unexpected error' },
      { status: 500 },
    );
  }
}
