import { NextResponse } from 'next/server';
import { rollbackVersion } from '../../../../lib/releases';

export const dynamic = 'force-dynamic';

// No gate: rollbacks must be fast.
export async function POST() {
  try {
    const result = await rollbackVersion();
    if (!result.ok) {
      return NextResponse.json({ error: result.error, message: result.message, details: result.details }, { status: result.status });
    }
    return NextResponse.json(result.data, { status: 200 });
  } catch (err) {
    console.error('rollback failed', err);
    return NextResponse.json(
      { error: 'INTERNAL_ERROR', message: err instanceof Error ? err.message : 'Unexpected error' },
      { status: 500 },
    );
  }
}
