# RefundDesk (CIS 591, Module 5)

AI support agent for **Trailhead Supply Co.** An LLM *extracts* facts from refund emails; deterministic code
*decides*. Low-risk refunds are issued automatically, everything else goes to a human queue. Traces, metrics
and alerts make it operable. Source of truth: `spec/SPEC.md`. **New here? Read [GUIDE.md](GUIDE.md)** for how to run and demo it, plus a teaching reference for TAs and instructors.

```
email → redactPII → LLM extract (retry/timeout) → decideTicket → evaluateRefund
      → approve ≤ $200: auto refund | escalate: /approvals | every step: spans → metrics → alerts → /ops
```

## Stack
Next.js (App Router, `src/`), TypeScript, Tailwind, Supabase Postgres (server-side, service role), zod, vitest, tsx, Node 24.
LLM via Anthropic Messages API (`fetch`), or a no-key `heuristic` provider.

## Setup
1. Create a Supabase project and run `spec/schema.sql` in the SQL editor.
2. `cp .env.example .env.local` and fill it in (secrets stay in `.env.local`).
3. `npm ci && npm run seed`

## Commands
| Command | Purpose |
|---|---|
| `npm run dev` / `build` / `lint` | Dev server, production build, lint |
| `npm test` | Unit + acceptance tests (`spec/tests/`, `tests/`) |
| `npm run demo [-- --tickets N --days N --seed N]` | Wipe runtime data and fill the app with simulated demo data (see GUIDE.md) |
| `npm run seed [-- --reset]` | Load 20 orders, chaos row, prompt v1 (`--reset` also clears tickets/spans/refunds/alerts) |
| `npm run eval -- --prompt <id> [--dataset golden\|adversarial\|drift\|all]` | Offline eval (default golden + adversarial); exits 1 if a gate fails |
| `npm run prompt:add -- <id> <path> [--notes "..."]` | Register a draft prompt version |
| `npm run traffic -- --scenario normal\|drift [--count N] [--base-url URL]` | Send labeled synthetic tickets (dry run), then run the monitor and print new alerts |
| `npm run chaos -- none\|latency\|errors` | Fault injection for game day (`latency` = 9 s LLM delay, `errors` = HTTP 503) |

## Layout
- `src/lib/config.ts`: constants (`STORE_DATE` is "now" for all policy decisions, thresholds, pricing, gates)
- `src/lib/types.ts`: domain types (`Order`, `PolicyResult`, `Extraction`, `ReasonCode`, ...)
- `src/lib/policy.ts`: `evaluateRefund`, pure refund rules
- `src/lib/redact.ts`: `redactPII`, pure card/SSN scrubbing, run before the LLM and before storage
- `src/lib/decide.ts`: `decideTicket` guardrails G1–G6 (LLM down, injection, not a refund, no order id, identity mismatch), then policy
- `src/lib/replies.ts`: `buildReply` customer templates; escalations always use a generic reply (no internal codes leak)
- `src/lib/model.ts`: `AnthropicModel` (fetch), `HeuristicModel` (regex, no key), `MockModel` (tests), `ChaosModel`, `getModelFromEnv`
- `src/lib/extract.ts`: zod schema, `parseExtraction`, `extractTicket` (per-attempt timeout, retry on timeout/429/5xx/bad JSON, no retry on other 4xx)
- `src/lib/refunds.ts`: `authorizeRefund` (agent ≤ $200, exact amount, delivered only) and `issueRefund`
- `src/lib/trace.ts` / `pipeline.ts`: `processTicket` runs redact → extract → lookup → decide → refund → reply, recording a span per step
- `src/lib/db.ts`: `getDb()`, the only DB access point; server code only
- `src/app/`: Inbox `/` (submit, recent tickets; rows open the detail view), `/tickets/[id]` (why-decision, pipeline timeline, extraction, order, trace), `/approvals`, `/ops`, `/dashboard` (executive summary: business KPIs, charts, SLOs, risk), `/lifecycle` (lifecycle stages with live evidence), `/safety` (reliability, security and governance evidence)
- `src/app/api/`: `POST /api/tickets`, `POST /api/approvals/[ticketId]`
- `src/components/`: `Nav`, `DecisionBadge`, `TicketForm`, `ApprovalButtons`
- `src/lib/evaluate.ts`: pure `gradeCase` (pass = decision + reason_code, plus redaction count when expected) and failure taxonomy
- `src/lib/releases.ts`: gate check, `promoteVersion`, `rollbackVersion`, `retireVersion` (one live, at most one standby)
- `src/lib/metrics.ts`: pure `computeMetrics` (accuracy, nearest-rank p95, error/escalation/injection rates, cost, PII leaks) with minimum sample sizes
- `src/lib/monitor.ts`: pure `evaluateRules` (7 alert rules), dedup, and `runMonitor` (reads last 50 tickets, inserts new alerts)
- `src/components/`: `Nav` (vertical sidebar), `NavLinks`, `ThemeToggle` (dark default, saved in localStorage), `PageHeader`, `charts` (dependency-free SVG/Tailwind charts)
- `src/app/ops/page.tsx`: SLO cards with trend sparklines, decision/reason/latency/eval charts, alerts, prompt versions (promote/rollback/retire), live metrics by prompt, recent eval runs
- `src/lib/explain.ts`: plain-English explanation for every reason code
- `scripts/`: `seed`, `demo`, `eval`, `add-prompt`, `traffic`, `chaos`
- `spec/`: spec, schema, seed orders, eval datasets, acceptance tests (read-only)
- `prompts/`: versioned LLM prompts

## CI
`.github/workflows/ci.yml` runs lint, tests and build on every push to `main` and every pull request, plus a secrets/hygiene check and an advisory dependency audit. It needs no secrets.

## UI
Shadcn/ui components (`src/components/ui/`) plus Tailwind; no chart or theme libraries. Dark theme is the default; the sidebar toggle switches to light and remembers the choice.

## Rules of the road
Pure modules never read env or import `db.ts`; `src/lib/` and `scripts/` use relative imports; the LLM never decides money.

## Status
| Milestone | State |
|---|---|
| M0 Setup (env, db, seed) | done |
| M1 Deterministic core: base policy, PII redaction | done |
| M2 Policy v2 (TDD): tiers, final sale, defects, abuse review | done |
| M3 LLM layer, pipeline, tickets/approvals UI | done |
| M4 Evals and prompt release management (code done; v2 prompt and eval report are student work) | in progress |
| M5 Metrics, alerts, `/ops`, cron, traffic/chaos (code done; Vercel deploy pending) | in progress |
| M7 Demo and teaching layer: demo data, ticket detail, Lifecycle and Safety pages, GUIDE.md | done |
| M6 Game day: runbook, postmortem, retire v1 | todo |

## API
- `POST /api/tickets` `{from_email, subject, body}` → 201 `{ticket_id, decision, reason_code, refund_amount_cents, reply, status, ...}`.
  `dry_run` and `expected_*` labels need the `x-traffic-secret` header (= `CRON_SECRET`), else 403. 503 if no live prompt.
- `POST /api/approvals/[ticketId]` `{action: approve|deny}` → 200 `{ticket}`; 404 / 409 `NOT_PENDING` / 422 `REFUND_NOT_AUTHORIZED`.
- `POST /api/prompt-versions/[id]/promote`: gated (latest golden and adversarial runs each ≥ 90% with 0 regressions) → 200 `{live, standby}`; 404 / 409 `ALREADY_LIVE` `RETIRED` `GATE_FAILED`.
- `POST /api/prompt-versions/rollback`: no gate; standby becomes live, the failing live returns to draft → 200 `{live, rolled_back}`; 409 `NO_STANDBY`.
- `POST /api/prompt-versions/[id]/retire` `{reason}` (min 5 chars) → 200 `{version}`; 404 / 409 `CANNOT_RETIRE_LIVE` `ALREADY_RETIRED`.
- `POST /api/alerts/[id]` `{action: acknowledge|resolve}` → 200 `{alert}`; 404 / 409 `ALREADY_RESOLVED`.
- `POST /api/ops/check` runs the monitor → `{metrics, new_alerts}`. `GET /api/cron/monitor` does the same with `Authorization: Bearer <CRON_SECRET>` (else 401);
  `vercel.json` schedules it daily at 12:00 UTC.
- Errors are always `{error, message, details?}`.

## Monitoring
Metrics use the last 50 tickets and stay `n/a` below their minimum sample (20 labeled for accuracy; 10 for p95 and LLM errors; 20 for escalation and injection rates).
Alerts fire strictly past the threshold, critical: accuracy < 85%, LLM error rate > 10%, any PII leak; warning: p95 > 8 s, escalation > 40%, injection > 20%, avg cost > $0.01.
An open or acknowledged alert for a rule suppresses new ones for that rule. Chaos mode wraps the LLM for ticket traffic only (never evals).

## Evals
`spec/evals/` holds `golden` (17), `adversarial` (10) and `drift` (held back until M6). The runner refuses to start if DB orders differ from
`spec/seed/orders.json` (`npm run seed` first), runs each case through the pipeline without persisting or refunding, grades it, and stores
`eval_runs` / `eval_results`. A regression is a case that passed in the baseline run (latest run of the live version) and now fails.
Failure categories: `LLM_ERROR`, `LEAKED_PII`, `FOLLOWED_INJECTION`, `FALSE_INJECTION`, `WRONG_INTENT`, `WRONG_ORDER_ID`, `WRONG_REASON`, `OTHER`.

## LLM provider
`LLM_PROVIDER=anthropic` needs an `ANTHROPIC_API_KEY` (workspace-scoped keys only). If the LLM fails, the ticket is escalated
as `LLM_UNAVAILABLE`, never guessed. Set `LLM_PROVIDER=heuristic` to run without a key.

## Policy (v2, first match wins; `reason: other` counts as `changed_mind`)
1. No order → deny · 2. Already refunded → deny · 3. In transit → deny · 4. Gift card → deny
5. 3+ prior refunds → escalate (abuse review)
6. Damaged / wrong item within 90 days → approve, or escalate if over $200
7. Final sale → deny
8. Past the return window (standard 30 days, gold 45; last day allowed) → deny
9. Over $200 → escalate · 10. Otherwise approve the full amount
