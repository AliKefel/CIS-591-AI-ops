import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface EvalCase {
  id: string;
  from_email: string;
  subject: string;
  body: string;
  expected: { decision: string; reason_code: string };
}

const root = resolve(__dirname, '..');

function loadCases(file: string): EvalCase[] {
  return readFileSync(resolve(root, 'spec/evals', file), 'utf8')
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as EvalCase);
}

// Usage: npm run traffic -- --scenario normal|drift [--count N] [--base-url URL]
async function main() {
  const args = process.argv.slice(2);
  const valueOf = (flag: string) => {
    const i = args.indexOf(flag);
    return i === -1 ? undefined : args[i + 1];
  };

  const scenario = valueOf('--scenario');
  if (scenario !== 'normal' && scenario !== 'drift') {
    throw new Error('Usage: npm run traffic -- --scenario normal|drift [--count N] [--base-url URL]');
  }
  const count = Number(valueOf('--count') ?? 50);
  if (!Number.isInteger(count) || count < 1) throw new Error('--count must be a positive integer');
  const baseUrl = (valueOf('--base-url') ?? process.env.BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
  const secret = process.env.CRON_SECRET;
  if (!secret) throw new Error('CRON_SECRET is not set');

  const cases =
    scenario === 'normal' ? [...loadCases('golden.jsonl'), ...loadCases('adversarial.jsonl')] : loadCases('drift.jsonl');

  console.log(`Sending ${count} ${scenario} tickets to ${baseUrl}`);
  let failures = 0;
  for (let i = 0; i < count; i++) {
    const c = cases[i % cases.length];
    const started = Date.now();
    try {
      const res = await fetch(`${baseUrl}/api/tickets`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-traffic-secret': secret },
        body: JSON.stringify({
          from_email: c.from_email,
          subject: c.subject,
          body: c.body,
          dry_run: true,
          expected_decision: c.expected.decision,
          expected_reason_code: c.expected.reason_code,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        failures++;
        console.log(`[${i + 1}/${count}] ${c.id} HTTP ${res.status} ${json.error}: ${json.message}`);
      } else {
        const ok = json.decision === c.expected.decision && json.reason_code === c.expected.reason_code;
        console.log(
          `[${i + 1}/${count}] ${c.id} ${json.decision}/${json.reason_code} ${ok ? '✓' : `✗ (expected ${c.expected.decision}/${c.expected.reason_code})`} ${Date.now() - started}ms`,
        );
      }
    } catch (err) {
      failures++;
      console.log(`[${i + 1}/${count}] ${c.id} request failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  const res = await fetch(`${baseUrl}/api/ops/check`, { method: 'POST' });
  const check = await res.json();
  if (!res.ok) throw new Error(`Monitor check failed: ${check.error}: ${check.message}`);
  console.log(`\nMonitor check: ${check.new_alerts.length} new alert(s)`);
  for (const a of check.new_alerts) console.log(`  [${a.severity}] ${a.rule}: ${a.message} (observed ${a.observed}, threshold ${a.threshold})`);
  if (failures > 0) console.log(`${failures} request(s) failed`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
