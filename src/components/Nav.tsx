import Link from 'next/link';
import { getDb } from '@/lib/db';

async function loadStatus(): Promise<{ live: string | null; chaos: string }> {
  try {
    const db = getDb();
    const [{ data: live }, { data: chaos }] = await Promise.all([
      db.from('prompt_versions').select('id').eq('status', 'live').maybeSingle(),
      db.from('chaos_config').select('mode').eq('id', 1).maybeSingle(),
    ]);
    return { live: live?.id ?? null, chaos: chaos?.mode ?? 'none' };
  } catch {
    return { live: null, chaos: 'none' };
  }
}

export default async function Nav() {
  const { live, chaos } = await loadStatus();
  return (
    <nav className="border-b border-gray-200 bg-white">
      <div className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3 text-sm">
        <span className="text-base font-bold text-gray-900">RefundDesk</span>
        <Link href="/" className="text-gray-600 hover:text-gray-900">Inbox</Link>
        <Link href="/approvals" className="text-gray-600 hover:text-gray-900">Approvals</Link>
        <Link href="/ops" className="text-gray-600 hover:text-gray-900">Ops</Link>
        <div className="ml-auto flex items-center gap-2">
          {chaos !== 'none' && (
            <span className="rounded bg-red-600 px-2 py-0.5 text-xs font-semibold text-white">CHAOS: {chaos}</span>
          )}
          <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-700">
            Live prompt: {live ?? 'none'}
          </span>
        </div>
      </div>
    </nav>
  );
}
