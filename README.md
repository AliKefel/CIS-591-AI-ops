# RefundDesk (CIS 591, Module 5)

AI support agent for **Trailhead Supply Co.** An LLM *extracts* facts from refund emails; deterministic code
*decides*. Low-risk refunds are issued automatically, everything else goes to a human queue. Traces, metrics
and alerts make it operable. Source of truth: `spec/SPEC.md` (never edited).

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
| `npm run seed [-- --reset]` | Load 20 orders, chaos row, prompt v1 (`--reset` also clears tickets/spans/refunds/alerts) |

Planned (later milestones): `eval`, `traffic`, `chaos`, `prompt:add`.

## Layout
- `src/lib/config.ts`: constants (`STORE_DATE` is "now" for all policy decisions, thresholds, pricing, gates)
- `src/lib/types.ts`: domain types (`Order`, `PolicyResult`, `Extraction`, `ReasonCode`, ...)
- `src/lib/policy.ts`: `evaluateRefund`, pure refund rules
- `src/lib/redact.ts`: `redactPII`, pure card/SSN scrubbing, run before the LLM and before storage
- `src/lib/db.ts`: `getDb()`, the only DB access point; server code only
- `scripts/seed.ts`: DB seeding
- `spec/`: spec, schema, seed orders, eval datasets, acceptance tests (read-only)
- `prompts/`: versioned LLM prompts

## Rules of the road
Pure modules never read env or import `db.ts`; `src/lib/` and `scripts/` use relative imports; the LLM never decides money.

## Status
| Milestone | State |
|---|---|
| M0 Setup (env, db, seed) | done |
| M1 Deterministic core: base policy B1–B7, PII redaction | done |
| M2 Policy v2 (TDD) | next |
| M3 LLM layer, pipeline, tickets/approvals UI | todo |
| M4 Evals and prompt release management | todo |
| M5 Metrics, alerts, `/ops`, cron, traffic/chaos | todo |
| M6 Game day: runbook, postmortem, retire v1 | todo |

## Policy (current: base policy)
Deny: order missing, already refunded, not delivered, gift card, more than 30 days since delivery (day 30 allowed).
Escalate: over $200. Otherwise approve the full amount.
