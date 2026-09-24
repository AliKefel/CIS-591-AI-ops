import { GATES } from './config';
import { getDb } from './db';

export type PromptStatus = 'draft' | 'live' | 'standby' | 'retired';

export interface PromptVersion {
  id: string;
  content: string;
  status: PromptStatus;
  notes: string | null;
  created_at: string;
  promoted_at: string | null;
  retired_at: string | null;
  retired_reason: string | null;
}

export interface RunSummary {
  score: number;
  regressions: number;
}

export type ReleaseResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string; message: string; details?: unknown };

const fail = (status: number, error: string, message: string, details?: unknown) =>
  ({ ok: false, status, error, message, details }) as const;

// Gate (SPEC §9): latest golden and adversarial runs must each score >= threshold with zero regressions.
export function evaluateGate(runs: { golden: RunSummary | null; adversarial: RunSummary | null }): {
  passed: boolean;
  details: { golden: RunSummary | null; adversarial: RunSummary | null };
} {
  const ok = (name: 'golden' | 'adversarial') => {
    const run = runs[name];
    return run !== null && run.score >= GATES[name] && run.regressions === 0;
  };
  return { passed: ok('golden') && ok('adversarial'), details: runs };
}

async function getVersion(id: string): Promise<PromptVersion | null> {
  const { data, error } = await getDb().from('prompt_versions').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as PromptVersion | null) ?? null;
}

async function getByStatus(status: PromptStatus): Promise<PromptVersion | null> {
  const { data, error } = await getDb().from('prompt_versions').select('*').eq('status', status).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as PromptVersion | null) ?? null;
}

async function update(id: string, fields: Partial<PromptVersion>): Promise<PromptVersion> {
  const { data, error } = await getDb().from('prompt_versions').update(fields).eq('id', id).select('*').single();
  if (error) throw new Error(`Could not update ${id}: ${error.message}`);
  return data as PromptVersion;
}

async function latestRun(promptId: string, dataset: 'golden' | 'adversarial'): Promise<RunSummary | null> {
  const { data, error } = await getDb()
    .from('eval_runs')
    .select('score, regressions')
    .eq('prompt_version_id', promptId)
    .eq('dataset', dataset)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? { score: Number(data.score), regressions: Number(data.regressions) } : null;
}

export async function promoteVersion(id: string): Promise<ReleaseResult<{ live: PromptVersion; standby: PromptVersion | null }>> {
  const candidate = await getVersion(id);
  if (!candidate) return fail(404, 'NOT_FOUND', `Prompt version ${id} not found`);
  if (candidate.status === 'live') return fail(409, 'ALREADY_LIVE', `${id} is already live`);
  if (candidate.status === 'retired') return fail(409, 'RETIRED', `${id} is retired and cannot be promoted`);

  const gate = evaluateGate({
    golden: await latestRun(id, 'golden'),
    adversarial: await latestRun(id, 'adversarial'),
  });
  if (!gate.passed) return fail(409, 'GATE_FAILED', `${id} did not pass the release gate`, gate.details);

  const oldStandby = await getByStatus('standby');
  const oldLive = await getByStatus('live');

  // The unique indexes allow one live and one standby, so vacate them in order. The candidate may itself be the standby.
  const done: { id: string; status: PromptStatus; promoted_at?: string | null }[] = [];
  try {
    if (oldStandby) {
      await update(oldStandby.id, { status: 'draft' });
      done.push({ id: oldStandby.id, status: 'standby' });
    }
    if (oldLive) {
      await update(oldLive.id, { status: 'standby' });
      done.push({ id: oldLive.id, status: 'live' });
    }
    const live = await update(id, { status: 'live', promoted_at: new Date().toISOString() });
    return { ok: true, data: { live, standby: oldLive ? await getVersion(oldLive.id) : null } };
  } catch (err) {
    // Best-effort restore, newest change first, so a partial promotion never leaves the system without a live prompt.
    for (const prior of done.reverse()) {
      await update(prior.id, { status: prior.status }).catch(() => {});
    }
    await update(id, { status: candidate.status, promoted_at: candidate.promoted_at }).catch(() => {});
    throw err;
  }
}

export async function rollbackVersion(): Promise<ReleaseResult<{ live: PromptVersion; rolled_back: PromptVersion }>> {
  const standby = await getByStatus('standby');
  if (!standby) return fail(409, 'NO_STANDBY', 'There is no standby version to roll back to');
  const live = await getByStatus('live');
  if (!live) return fail(409, 'NO_STANDBY', 'There is no live version to roll back from');

  const stamp = `rolled back ${new Date().toISOString()}`;
  const rolledBack = await update(live.id, { status: 'draft', notes: live.notes ? `${live.notes}; ${stamp}` : stamp });
  try {
    const newLive = await update(standby.id, { status: 'live', promoted_at: new Date().toISOString() });
    return { ok: true, data: { live: newLive, rolled_back: rolledBack } };
  } catch (err) {
    await update(live.id, { status: 'live', notes: live.notes }).catch(() => {});
    throw err;
  }
}

export async function retireVersion(id: string, reason: string): Promise<ReleaseResult<{ version: PromptVersion }>> {
  const version = await getVersion(id);
  if (!version) return fail(404, 'NOT_FOUND', `Prompt version ${id} not found`);
  if (version.status === 'live') return fail(409, 'CANNOT_RETIRE_LIVE', 'Roll back or promote another version first');
  if (version.status === 'retired') return fail(409, 'ALREADY_RETIRED', `${id} is already retired`);

  const retired = await update(id, {
    status: 'retired',
    retired_at: new Date().toISOString(),
    retired_reason: reason,
  });
  return { ok: true, data: { version: retired } };
}
