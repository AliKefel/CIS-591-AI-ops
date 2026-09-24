import Link from 'next/link';
import PageHeader from '@/components/PageHeader';
import PromptVersionActions from '@/components/PromptVersionActions';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getDb } from '@/lib/db';
import { diffLines } from '@/lib/diff';

export const dynamic = 'force-dynamic';

interface Version {
  id: string;
  content: string;
  status: 'draft' | 'live' | 'standby' | 'retired';
  notes: string | null;
  created_at: string;
  promoted_at: string | null;
  retired_at: string | null;
  retired_reason: string | null;
}

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function PromptsPage(props: PageProps<'/prompts'>) {
  const sp = await props.searchParams;
  const db = getDb();
  const [versionsRes, runsRes, ticketsRes] = await Promise.all([
    db.from('prompt_versions').select('*').order('created_at', { ascending: true }),
    db.from('eval_runs').select('prompt_version_id, dataset, score, regressions, created_at').order('created_at', { ascending: false }).limit(100),
    db.from('tickets').select('prompt_version_id, decision, reason_code, expected_decision, expected_reason_code').order('created_at', { ascending: false }).limit(1000),
  ]);
  const versions = (versionsRes.data ?? []) as Version[];
  const runs = runsRes.data ?? [];
  const tickets = ticketsRes.data ?? [];

  const selected = versions.find((v) => v.id === first(sp.v)) ?? versions.find((v) => v.status === 'live') ?? versions[0];
  const compareTo = versions.find((v) => v.id === first(sp.compare) && v.id !== selected?.id);
  const hasStandby = versions.some((v) => v.status === 'standby');
  const latest = (id: string, dataset: string) => runs.find((r) => r.prompt_version_id === id && r.dataset === dataset);

  if (!selected) {
    return (
      <div>
        <PageHeader title="Prompts" description="Versioned instructions given to the LLM." />
        <p className="text-sm text-muted-foreground">No prompt versions yet. Run <code>npm run seed</code>.</p>
      </div>
    );
  }

  const used = tickets.filter((t) => t.prompt_version_id === selected.id);
  const labeled = used.filter((t) => t.expected_decision !== null);
  const correct = labeled.filter((t) => t.decision === t.expected_decision && t.reason_code === t.expected_reason_code).length;
  const g = latest(selected.id, 'golden');
  const a = latest(selected.id, 'adversarial');
  const words = selected.content.trim().split(/\s+/).length;
  const diff = compareTo ? diffLines(compareTo.content, selected.content) : null;
  const added = diff?.filter((l) => l.type === 'add').length ?? 0;
  const removed = diff?.filter((l) => l.type === 'del').length ?? 0;

  return (
    <div>
      <PageHeader title="Prompts" description="The versioned instructions given to the LLM. Change the prompt, never the code, then re-run the evals." />

      <div className="grid gap-6 lg:grid-cols-[17rem_1fr]">
        <nav className="space-y-2" aria-label="Prompt versions">
          {[...versions].reverse().map((v) => {
            const vg = latest(v.id, 'golden');
            const va = latest(v.id, 'adversarial');
            const active = v.id === selected.id;
            return (
              <Link
                key={v.id}
                href={`/prompts?v=${v.id}`}
                className={`block rounded-xl border p-3 transition-colors ${active ? 'border-primary bg-primary/10' : 'hover:bg-muted'}`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold">{v.id}</span>
                  <Badge variant="outline" className={v.status === 'live' ? 'border-green-600 text-green-600' : ''}>{v.status}</Badge>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {vg || va ? `golden ${vg ? pct(Number(vg.score)) : '—'} · adv. ${va ? pct(Number(va.score)) : '—'}` : 'No eval runs yet'}
                </div>
                {v.notes && <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">{v.notes}</div>}
              </Link>
            );
          })}
        </nav>

        <div className="min-w-0 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-3 text-lg">
                Version {selected.id}
                <Badge variant="outline" className={selected.status === 'live' ? 'border-green-600 text-green-600' : ''}>{selected.status}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
                <div><dt className="text-xs text-muted-foreground">Created</dt><dd>{new Date(selected.created_at).toLocaleDateString()}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Size</dt><dd>{words} words · ~{Math.round(selected.content.length / 4)} tokens</dd></div>
                <div><dt className="text-xs text-muted-foreground">Golden / adversarial</dt><dd className="tabular-nums">{g ? pct(Number(g.score)) : '—'} / {a ? pct(Number(a.score)) : '—'}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Regressions</dt><dd className="tabular-nums">{g || a ? (g?.regressions ?? 0) + (a?.regressions ?? 0) : '—'}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Live tickets</dt><dd className="tabular-nums">{used.length}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Live accuracy (labeled)</dt><dd className="tabular-nums">{labeled.length ? `${((correct / labeled.length) * 100).toFixed(1)}% (${labeled.length})` : 'n/a'}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Promoted</dt><dd>{selected.promoted_at ? new Date(selected.promoted_at).toLocaleDateString() : '—'}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Retired</dt><dd>{selected.retired_at ? `${new Date(selected.retired_at).toLocaleDateString()}: ${selected.retired_reason}` : '—'}</dd></div>
              </dl>
              {selected.notes && <p className="text-sm text-muted-foreground"><span className="font-medium text-foreground">Notes:</span> {selected.notes}</p>}
              <PromptVersionActions id={selected.id} status={selected.status} hasStandby={hasStandby} />
              <p className="text-xs text-muted-foreground">Promotion is refused unless the latest golden and adversarial runs both score 90% or more with no regressions. Rollback is never gated.</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2">
                {diff ? `Changes from ${compareTo!.id} to ${selected.id}` : 'Prompt text'}
                {diff && <span className="text-xs font-normal"><span className="text-green-600">+{added}</span> <span className="text-red-500">−{removed}</span></span>}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-muted-foreground">Compare with:</span>
                {versions.filter((v) => v.id !== selected.id).map((v) => (
                  <Link key={v.id} href={`/prompts?v=${selected.id}&compare=${v.id}`} className={`rounded-full border px-2.5 py-0.5 ${compareTo?.id === v.id ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-muted'}`}>
                    {v.id}
                  </Link>
                ))}
                {compareTo && <Link href={`/prompts?v=${selected.id}`} className="text-muted-foreground underline-offset-4 hover:underline">clear</Link>}
              </div>
              {diff ? (
                <pre className="max-h-[32rem] overflow-auto rounded-lg bg-muted p-3 font-mono text-xs leading-relaxed">
                  {diff.map((l, i) => (
                    <div key={i} className={`whitespace-pre-wrap break-words ${l.type === 'add' ? 'bg-green-500/15 text-green-500' : l.type === 'del' ? 'bg-red-500/15 text-red-500' : 'text-muted-foreground'}`}>
                      {l.type === 'add' ? '+ ' : l.type === 'del' ? '− ' : '  '}{l.text || ' '}
                    </div>
                  ))}
                </pre>
              ) : (
                <pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap rounded-lg bg-muted p-3 font-mono text-xs leading-relaxed">{selected.content}</pre>
              )}
              <p className="text-xs text-muted-foreground">
                This text is sent to the model as the system prompt. The email arrives separately as untrusted input, and the model can only return extracted facts. Code, not the prompt, decides refunds.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
