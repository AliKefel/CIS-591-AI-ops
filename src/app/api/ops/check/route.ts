import { NextResponse } from 'next/server';
import { runMonitor } from '../../../../lib/monitor';

export const dynamic = 'force-dynamic';

// No auth: the app has no accounts (SPEC §16).
export async function POST() {
  try {
    return NextResponse.json(await runMonitor(), { status: 200 });
  } catch (err) {
    console.error('POST /api/ops/check failed', err);
    return NextResponse.json(
      { error: 'INTERNAL_ERROR', message: err instanceof Error ? err.message : 'Unexpected error' },
      { status: 500 },
    );
  }
}
