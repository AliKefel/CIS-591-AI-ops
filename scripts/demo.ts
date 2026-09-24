import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { MODEL_PRICING } from '../src/lib/config';
import { getDb } from '../src/lib/db';
import { decideTicket } from '../src/lib/decide';
import { computeMetrics, type MetricTicket } from '../src/lib/metrics';
import { evaluateRules, type FiredRule } from '../src/lib/monitor';
import { redactPII } from '../src/lib/redact';
import { buildReply } from '../src/lib/replies';
import type { Extraction, Order, PolicyResult } from '../src/lib/types';

// Usage: npm run demo [-- --tickets 400 --days 14 --seed 7]
// Wipes tickets/spans/refunds/alerts, restores orders, then fills the app with a believable two weeks of traffic:
// healthy operation, a provider incident (slow, then failing LLM calls) and a late quality drift.
// Tickets are simulated (no LLM is called) but every decision goes through the real guardrail + policy code.

const root = resolve(__dirname, '..');
const args = process.argv.slice(2);
const num = (flag: string, fallback: number) => {
  const i = args.indexOf(flag);
  return i === -1 ? fallback : Number(args[i + 1]);
};
const TICKETS = num('--tickets', 400);
const DAYS = num('--days', 14);
const SEED = num('--seed', 7);

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(SEED);
const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
const between = (lo: number, hi: number) => lo + rand() * (hi - lo);

interface EvalCase {
  id: string;
  from_email: string;
  subject: string;
  body: string;
  expected: Partial<Extraction> & { decision: PolicyResult['decision']; reason_code: PolicyResult['reason_code'] };
}

const loadCases = (file: string) =>
  readFileSync(resolve(root, 'spec/evals', file), 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as EvalCase);

type Phase = 'healthy' | 'slow' | 'outage' | 'drift';

interface Sim {
  ticket: Record<string, unknown>;
  spans: Record<string, unknown>[];
  metric: MetricTicket;
  at: number;
}

const MS_DAY = 86_400_000;

async function batches(table: string, rows: Record<string, unknown>[], size = 300) {
  const db = getDb();
  for (let i = 0; i < rows.length; i += size) {
    const { error } = await db.from(table).insert(rows.slice(i, i + size));
    if (error) throw new Error(`${table} insert: ${error.message}`);
  }
}

async function main() {
  const db = getDb();

  // 1. Reset runtime data and restore orders.
  for (const table of ['spans', 'refunds', 'tickets', 'alerts']) {
    const { error } = await db.from(table).delete().not('id', 'is', null);
    if (error) throw new Error(`reset ${table}: ${error.message}`);
  }
  const seedOrders = JSON.parse(readFileSync(resolve(root, 'spec/seed/orders.json'), 'utf8'));
  const { error: orderError } = await db.from('orders').upsert(seedOrders, { onConflict: 'id' });
  if (orderError) throw new Error(`orders: ${orderError.message}`);
  await db.from('chaos_config').upsert({ id: 1, mode: 'none', updated_at: new Date().toISOString() });

  const { data: live } = await db.from('prompt_versions').select('id').eq('status', 'live').maybeSingle();
  if (!live) throw new Error('No live prompt version. Run npm run seed first');
  const promptId = live.id as string;
  const orders = new Map((seedOrders as Order[]).map((o) => [o.id, o]));

  // 2. Timeline. Traffic is spread over the window; phases are defined as fractions of it.
  const end = Date.now();
  const start = end - DAYS * MS_DAY;
  const incidentAt = start + DAYS * MS_DAY * 0.45;
  const slowEnd = incidentAt + 60 * 60_000;
  const outageEnd = slowEnd + 2 * 60 * 60_000;
  const driftStart = end - 2.5 * MS_DAY;

  const times = Array.from({ length: TICKETS }, () => start + rand() * (end - start));
  // Guarantee traffic inside the incident so it is visible on the charts.
  for (let i = 0; i < 24; i++) times[i] = incidentAt + rand() * (outageEnd - incidentAt);
  times.sort((a, b) => a - b);

  const phaseAt = (t: number): Phase =>
    t >= incidentAt && t < slowEnd ? 'slow' : t >= slowEnd && t < outageEnd ? 'outage' : t >= driftStart ? 'drift' : 'healthy';

  const cases = [...loadCases('golden.jsonl'), ...loadCases('adversarial.jsonl')];
  const quiet = cases.filter((x) => x.expected.decision !== 'escalate');
  const loud = cases.filter((x) => x.expected.decision === 'escalate');
  const pricing = MODEL_PRICING['claude-haiku-4-5-20251001'];
  const cost = (i: number, o: number) => (i * pricing.inputPerMTok + o * pricing.outputPerMTok) / 1_000_000;

  const sims: Sim[] = [];
  let pendingLeft = 8; // newest human-review escalations left waiting in /approvals

  for (let idx = times.length - 1; idx >= 0; idx--) {
    const at = times[idx];
    const phase = phaseAt(at);
    const c = rand() < 0.72 ? pick(quiet) : pick(loud); // most support mail is routine; escalations are the minority

    // What the model "extracted" when it behaves.
    let extraction: Extraction | null = {
      intent: c.expected.intent ?? 'refund_request',
      order_id: c.expected.order_id ?? null,
      reason: c.expected.intent === 'other' ? null : c.expected.reason ?? 'changed_mind',
      injection_detected: c.expected.injection_detected ?? false,
    };

    // Model mistakes: a few percent when healthy, many during drift.
    const errorRate = phase === 'drift' ? 0.3 : 0.05;
    const modes: (() => void)[] = [];
    const ex = extraction;
    if (ex.order_id) {
      modes.push(() => {
        const n = Number(ex.order_id!.slice(4));
        ex.order_id = `ORD-${n + (rand() < 0.5 ? 1 : 9000 - n)}`;
      });
    }
    if (ex.injection_detected) modes.push(() => (ex.injection_detected = false));
    if (ex.reason) modes.push(() => (ex.reason = ex.reason === 'damaged' ? 'changed_mind' : 'damaged'));
    if (ex.intent === 'refund_request') modes.push(() => (ex.intent = 'other'));
    if (phase !== 'outage' && rand() < errorRate && modes.length) pick(modes)();

    // LLM attempts (spans) for this ticket.
    const bodyRedacted = redactPII(c.body);
    const inTok = Math.round(170 + c.body.length / 4 + between(-8, 8));
    const outTok = Math.round(between(38, 52));
    const attemptSpans: { ok: boolean; ms: number; error?: string }[] = [];
    if (phase === 'slow') {
      attemptSpans.push({ ok: false, ms: 10_000, error: 'LLM call timed out after 10000ms' });
      attemptSpans.push({ ok: true, ms: between(6500, 9500) });
    } else if (phase === 'outage') {
      attemptSpans.push({ ok: false, ms: between(30, 90), error: 'Anthropic API returned HTTP 503' });
      attemptSpans.push({ ok: false, ms: between(30, 90), error: 'Anthropic API returned HTTP 503' });
      extraction = null;
    } else if (rand() < 0.03) {
      attemptSpans.push({ ok: false, ms: between(60, 120), error: 'Anthropic API returned HTTP 529' });
      attemptSpans.push({ ok: true, ms: between(900, 1600) });
    } else {
      attemptSpans.push({ ok: true, ms: Math.max(500, Math.round(1150 * Math.exp((rand() - 0.5) * 0.7 * (phase === 'drift' ? 1.4 : 1)))) });
    }

    const lookedUp = extraction?.order_id ? orders.get(extraction.order_id) ?? null : null;
    const result: PolicyResult = decideTicket({ extraction, order: lookedUp, fromEmail: c.from_email, now: new Date('2026-10-01T12:00:00Z') });
    const reply = buildReply(result, lookedUp);

    // Build spans on one timeline.
    const ticketId = randomUUID();
    let cursor = at;
    const spans: Record<string, unknown>[] = [];
    const span = (name: string, ms: number, extra: Record<string, unknown> = {}) => {
      spans.push({
        ticket_id: ticketId,
        name,
        attempt: 1,
        started_at: new Date(cursor).toISOString(),
        duration_ms: Math.max(0, Math.round(ms)),
        status: 'ok',
        error_message: null,
        input_tokens: 0,
        output_tokens: 0,
        cost_usd: 0,
        ...extra,
      });
      cursor += Math.max(1, Math.round(ms));
    };
    span('redact', between(0, 3));
    let totalIn = 0;
    let totalOut = 0;
    attemptSpans.forEach((a, i) => {
      const spent = a.ok || a.error?.includes('HTTP 529') ? inTok : 0;
      const outSpent = a.ok ? outTok : 0;
      totalIn += spent;
      totalOut += outSpent;
      span('llm.extract', a.ms, {
        attempt: i + 1,
        status: a.ok ? 'ok' : 'error',
        error_message: a.error ?? null,
        input_tokens: spent,
        output_tokens: outSpent,
        cost_usd: cost(spent, outSpent),
      });
      if (!a.ok && i < attemptSpans.length - 1) cursor += 500; // backoff
    });
    if (extraction?.order_id) span('db.lookup_order', between(18, 70));
    span('policy.decide', between(0, 2));
    const latency = cursor - at;

    // Most tickets are labeled synthetic traffic; some are "customer" tickets that go through human review.
    const human = result.decision === 'escalate' && rand() < 0.45;
    let status = 'closed';
    let source = 'traffic';
    let dryRun = true;
    if (human) {
      source = 'ui';
      dryRun = false;
      if (pendingLeft > 0) {
        status = 'pending_approval';
        pendingLeft--;
      } else {
        status = rand() < 0.6 ? 'approved_by_human' : 'denied_by_human';
      }
    }
    const labeled = source === 'traffic';
    const decision = result.decision;

    sims.push({
      at,
      ticket: {
        id: ticketId,
        created_at: new Date(at).toISOString(),
        source,
        dry_run: dryRun,
        from_email: c.from_email,
        subject: c.subject,
        body_redacted: bodyRedacted.text,
        redaction_count: bodyRedacted.count,
        prompt_version_id: promptId,
        intent: extraction?.intent ?? null,
        order_id_extracted: extraction?.order_id ?? null,
        reason: extraction?.reason ?? null,
        injection_detected: extraction?.injection_detected ?? null,
        llm_error: extraction === null,
        decision,
        reason_code: result.reason_code,
        refund_amount_cents: result.refund_amount_cents,
        reply,
        status,
        latency_ms: latency,
        input_tokens: totalIn,
        output_tokens: totalOut,
        cost_usd: cost(totalIn, totalOut),
        expected_decision: labeled ? c.expected.decision : null,
        expected_reason_code: labeled ? c.expected.reason_code : null,
      },
      spans,
      metric: {
        decision,
        reason_code: result.reason_code,
        expected_decision: labeled ? c.expected.decision : null,
        expected_reason_code: labeled ? c.expected.reason_code : null,
        latency_ms: latency,
        llm_error: extraction === null,
        injection_detected: extraction?.injection_detected ?? null,
        cost_usd: cost(totalIn, totalOut),
        body_redacted: bodyRedacted.text,
      },
    });
  }
  sims.reverse(); // chronological

  // 3. Replay the monitor over the timeline: rules fire when breached, get resolved after recovery.
  interface AlertSim {
    rule: FiredRule;
    created: number;
    resolved: number | null;
  }
  const alerts: AlertSim[] = [];
  const open = new Map<FiredRule['rule'], AlertSim>();
  for (let i = 9; i < sims.length; i += 10) {
    const window = sims.slice(Math.max(0, i - 49), i + 1).map((s) => s.metric);
    const firing = new Map(evaluateRules(computeMetrics(window)).map((r) => [r.rule, r]));
    const now = sims[i].at;
    for (const [name, r] of firing) {
      if (!open.has(name)) {
        const a = { rule: r, created: now, resolved: null };
        open.set(name, a);
        alerts.push(a);
      }
    }
    for (const [name, a] of [...open]) {
      if (!firing.has(name)) {
        a.resolved = now + 45 * 60_000; // an operator resolves it shortly after recovery
        open.delete(name);
      }
    }
  }

  const alertRows = alerts.map((a, i) => {
    const stillOpen = a.resolved === null;
    const acknowledged = stillOpen && a.rule.severity === 'warning' && i % 2 === 0;
    return {
      created_at: new Date(a.created).toISOString(),
      rule: a.rule.rule,
      severity: a.rule.severity,
      message: a.rule.message,
      observed: a.rule.observed,
      threshold: a.rule.threshold,
      status: stillOpen ? (acknowledged ? 'acknowledged' : 'open') : 'resolved',
      resolved_at: a.resolved === null ? null : new Date(Math.min(a.resolved, end)).toISOString(),
    };
  });

  // 4. Write everything.
  await batches('tickets', sims.map((s) => s.ticket));
  await batches('spans', sims.flatMap((s) => s.spans), 500);
  await batches('alerts', alertRows);

  const by = (key: string) => {
    const counts: Record<string, number> = {};
    for (const s of sims) counts[String(s.ticket[key])] = (counts[String(s.ticket[key])] ?? 0) + 1;
    return Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', ');
  };
  console.log(`Demo data loaded for prompt ${promptId} over ${DAYS} days (seed ${SEED})`);
  console.log(`  tickets: ${sims.length} (${by('decision')})`);
  console.log(`  status:  ${by('status')}`);
  console.log(`  spans:   ${sims.reduce((n, s) => n + s.spans.length, 0)}`);
  console.log(`  alerts:  ${alertRows.length} (${alertRows.filter((a) => a.status !== 'resolved').length} still active)`);
  const { count: runs } = await db.from('eval_runs').select('*', { count: 'exact', head: true });
  if (!runs) console.log('  note: no eval runs yet. Run: npm run eval -- --prompt ' + promptId);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
