import { NextResponse } from 'next/server';
import { runMonitor } from '../../../../lib/monitor';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'UNAUTHORIZED', message: 'Missing or invalid bearer token' }, { status: 401 });
  }
  try {
    return NextResponse.json(await runMonitor(), { status: 200 });
  } catch (err) {
    console.error('GET /api/cron/monitor failed', err);
    return NextResponse.json(
      { error: 'INTERNAL_ERROR', message: err instanceof Error ? err.message : 'Unexpected error' },
      { status: 500 },
    );
  }
}
