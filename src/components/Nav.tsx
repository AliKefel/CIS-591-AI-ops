import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
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

const linkClass =
  'rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground';

export default async function Nav() {
  const { live, chaos } = await loadStatus();
  return (
    <header className="sticky top-0 z-10 border-b bg-background/80 backdrop-blur">
      <nav className="mx-auto flex h-14 max-w-6xl items-center gap-1 px-4">
        <Link href="/" className="mr-4 text-base font-semibold tracking-tight">
          RefundDesk
        </Link>
        <Link href="/" className={linkClass}>Inbox</Link>
        <Link href="/approvals" className={linkClass}>Approvals</Link>
        <Link href="/ops" className={linkClass}>Ops</Link>
        <div className="ml-auto flex items-center gap-2">
          {chaos !== 'none' && <Badge className="bg-red-600 text-white">CHAOS: {chaos}</Badge>}
          <Badge variant="outline">Live prompt: {live ?? 'none'}</Badge>
        </div>
      </nav>
    </header>
  );
}
