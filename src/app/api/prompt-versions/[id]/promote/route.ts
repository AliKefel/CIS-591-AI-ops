import { NextResponse } from 'next/server';
import { promoteVersion } from '../../../../../lib/releases';

export const dynamic = 'force-dynamic';

export async function POST(_request: Request, ctx: RouteContext<'/api/prompt-versions/[id]/promote'>) {
  const { id } = await ctx.params;
  try {
    const result = await promoteVersion(id);
    if (!result.ok) {
      const { status, ...body } = result;
      return NextResponse.json({ error: body.error, message: body.message, details: body.details }, { status });
    }
    return NextResponse.json(result.data, { status: 200 });
  } catch (err) {
    console.error('promote failed', err);
    return NextResponse.json(
      { error: 'INTERNAL_ERROR', message: err instanceof Error ? err.message : 'Unexpected error' },
      { status: 500 },
    );
  }
}
