import Link from 'next/link';
import NavLinks from '@/components/NavLinks';
import ThemeToggle from '@/components/ThemeToggle';
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

// Vertical sidebar (stacks above the content on narrow screens).
export default async function Nav() {
  const { live, chaos } = await loadStatus();
  return (
    <aside className="flex shrink-0 flex-col gap-4 border-b bg-sidebar p-4 text-sidebar-foreground md:sticky md:top-0 md:h-screen md:w-60 md:border-r md:border-b-0 md:p-5">
      <Link href="/" className="flex items-center gap-2.5 px-1">
        <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">R</span>
        <span className="text-base font-semibold tracking-tight">RefundDesk</span>
      </Link>

      <NavLinks />

      <div className="flex flex-wrap items-center gap-2 md:mt-auto md:flex-col md:items-stretch">
        {chaos !== 'none' && (
          <Badge className="justify-center bg-red-600 text-white">CHAOS: {chaos}</Badge>
        )}
        <Badge variant="outline" className="justify-center">Live prompt: {live ?? 'none'}</Badge>
        <ThemeToggle />
      </div>
    </aside>
  );
}
