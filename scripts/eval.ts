import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { GATES } from '../src/lib/config';
import { getDb } from '../src/lib/db';
import { gradeCase, type ExpectedCase, type FailureCategory } from '../src/lib/evaluate';
import { getModelFromEnv } from '../src/lib/model';
import { processTicket } from '../src/lib/pipeline';

type Dataset = 'golden' | 'adversarial' | 'drift';

interface EvalCase {
  id: string;
  from_email: string;
  subject: string;
  body: string;
  expected: ExpectedCase;
}

interface SeedOrder {
  id: string;
  customer_name: string;
  customer_email: string;
  loyalty_tier: string;
  product_name: string;
  category: string;
  amount_cents: number;
  delivered_at: string | null;
  status: string;
  prior_refunds: number;
}

const root = resolve(__dirname, '..');

function parseArgs(): { promptId: string; datasets: Dataset[] } {
  const args = process.argv.slice(2);
  const valueOf = (flag: string) => {
    const i = args.indexOf(flag);
    return i === -1 ? undefined : args[i + 1];
  };
  const promptId = valueOf('--prompt');
  if (!promptId) throw new Error('Usage: npm run eval -- --prompt <id> [--dataset golden|adversarial|drift|all]');
  const dataset = valueOf('--dataset') ?? 'all';
  if (dataset === 'all') return { promptId, datasets: ['golden', 'adversarial'] };
  if (dataset === 'golden' || dataset === 'adversarial' || dataset === 'drift') return { promptId, datasets: [dataset] };
  throw new Error(`Unknown dataset "${dataset}" (use golden, adversarial, drift or all)`);
}

function loadCases(dataset: Dataset): EvalCase[] {
  return readFileSync(resolve(root, `spec/evals/${dataset}.jsonl`), 'utf8')
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as EvalCase);
}

const sameTime = (a: string | null, b: string | null) =>
  a === b || (a !== null && b !== null && new Date(a).getTime() === new Date(b).getTime());

// The eval depends on order data, so refuse to run if the DB has drifted from the seed file.
async function assertOrdersMatchSeed(): Promise<void> {
  const seed = JSON.parse(readFileSync(resolve(root, 'spec/seed/orders.json'), 'utf8')) as SeedOrder[];
  const { data, error } = await getDb().from('orders').select('*');
  if (error) throw new Error(`Could not read orders: ${error.message}`);
  const db = new Map((data as SeedOrder[]).map((o) => [o.id, o]));

  const same =
    db.size === seed.length &&
    seed.every((s) => {
      const d = db.get(s.id);
      return (
        d !== undefined &&
        d.customer_name === s.customer_name &&
        d.customer_email === s.customer_email &&
        d.loyalty_tier === s.loyalty_tier &&
        d.product_name === s.product_name &&
        d.category === s.category &&
        d.amount_cents === s.amount_cents &&
        d.status === s.status &&
        d.prior_refunds === s.prior_refunds &&
        sameTime(d.delivered_at, s.delivered_at)
      );
    });
  if (!same) throw new Error('Orders in the database differ from spec/seed/orders.json. Run npm run seed first');
}

async function findBaseline(promptId: string, dataset: Dataset) {
  const db = getDb();
  const { data: live, error: liveError } = await db.from('prompt_versions').select('id').eq('status', 'live').maybeSingle();
  if (liveError) throw new Error(liveError.message);
  // Baseline = latest run for the live version (which is the candidate's own previous run if the candidate is live).
  const baselineId = live?.id ?? promptId;
  const { data: run, error } = await db
    .from('eval_runs')
    .select('id')
    .eq('prompt_version_id', baselineId)
    .eq('dataset', dataset)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!run) return { runId: null as string | null, passed: new Set<string>() };
  const { data: results, error: resultsError } = await db.from('eval_results').select('case_id, passed').eq('run_id', run.id);
  if (resultsError) throw new Error(resultsError.message);
  return { runId: run.id as string, passed: new Set((results ?? []).filter((r) => r.passed).map((r) => r.case_id as string)) };
}

async function main() {
  const { promptId, datasets } = parseArgs();
  const db = getDb();

  const { data: prompt, error: promptError } = await db.from('prompt_versions').select('id, content').eq('id', promptId).maybeSingle();
  if (promptError) throw new Error(promptError.message);
  if (!prompt) throw new Error(`Prompt version "${promptId}" not found`);

  await assertOrdersMatchSeed();

  const model = getModelFromEnv();
  console.log(`Prompt ${promptId} · model ${model.name}\n`);
  let anyGateFailed = false;

  for (const dataset of datasets) {
    const cases = loadCases(dataset);
    const baseline = await findBaseline(promptId, dataset);

    const results: { id: string; passed: boolean; category: FailureCategory | null; expected: ExpectedCase; actual: unknown }[] = [];
    for (const c of cases) {
      const outcome = await processTicket({
        fromEmail: c.from_email,
        subject: c.subject,
        body: c.body,
        promptVersion: prompt,
        model,
        persist: false,
        dryRun: true,
        source: 'eval',
      });
      const actual = { extraction: outcome.extraction, result: outcome.result, redaction_count: outcome.redaction_count };
      const graded = gradeCase(c.expected, actual);
      results.push({ id: c.id, passed: graded.passed, category: graded.failure_category, expected: c.expected, actual });
    }

    const passed = results.filter((r) => r.passed).length;
    const score = cases.length === 0 ? 0 : passed / cases.length;
    const regressed = results.filter((r) => !r.passed && baseline.passed.has(r.id)).map((r) => r.id);

    const { data: run, error: runError } = await db
      .from('eval_runs')
      .insert({
        prompt_version_id: promptId,
        dataset,
        model: model.name,
        total: cases.length,
        passed,
        score,
        regressions: regressed.length,
        baseline_run_id: baseline.runId,
      })
      .select('id')
      .single();
    if (runError) throw new Error(`Could not insert eval run: ${runError.message}`);
    const { error: resultsError } = await db.from('eval_results').insert(
      results.map((r) => ({
        run_id: run.id,
        case_id: r.id,
        passed: r.passed,
        failure_category: r.category,
        expected: r.expected,
        actual: r.actual,
      })),
    );
    if (resultsError) throw new Error(`Could not insert eval results: ${resultsError.message}`);

    const gate = dataset === 'drift' ? null : GATES[dataset];
    const gatePassed = gate === null ? null : score >= gate && regressed.length === 0;
    if (gatePassed === false) anyGateFailed = true;

    console.log(`== ${dataset} ==`);
    console.log(`Score: ${(score * 100).toFixed(1)}% (${passed}/${cases.length})`);
    console.log(gate === null ? 'Gate: n/a (drift is diagnostic)' : `Gate (>= ${(gate * 100).toFixed(0)}%, 0 regressions): ${gatePassed ? 'PASS' : 'FAIL'}`);

    const byCategory = new Map<FailureCategory, string[]>();
    for (const r of results) {
      if (r.category) byCategory.set(r.category, [...(byCategory.get(r.category) ?? []), r.id]);
    }
    if (byCategory.size === 0) {
      console.log('Failures: none');
    } else {
      console.log('Failures:');
      for (const [category, ids] of byCategory) console.log(`  ${category} (${ids.length}): ${ids.join(', ')}`);
    }
    console.log(`Regressions vs baseline: ${regressed.length === 0 ? 'none' : regressed.join(', ')}${baseline.runId ? '' : ' (no baseline run yet)'}\n`);
  }

  process.exit(anyGateFailed ? 1 : 0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
