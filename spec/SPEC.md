# RefundDesk — Specification (CIS 591, Module 5)

**GenAI App Lifecycle and AIOps: Evaluation, Monitoring, and Maintenance**

This spec is deterministic: every table, type, route, rule, threshold, and page is defined here.
If something is not in this spec, do not build it. Where students have creative freedom, it is
marked **[STUDENT CHOICE]**.

---

## 1. Scenario

**Trailhead Supply Co.** is an online outdoor-gear store. Support is drowning in refund emails.
You are building **RefundDesk**, an AI support agent that:

1. Reads a customer email,
2. uses an LLM to **extract** structured facts (intent, order ID, reason, injection attempt),
3. applies **deterministic business rules** to decide `approve`, `deny`, or `escalate`,
4. issues low-risk refunds automatically and sends everything else to a **human approval queue**,
5. records **traces**, **metrics**, and **alerts** so the team can operate it safely.

**Core design principle:** the LLM never decides money. It only extracts facts. Code decides.

The store's simulated clock is fixed: `STORE_DATE = 2026-10-01T12:00:00Z`.

---

## 2. Architecture

```
email ─► redactPII ─► LLM extract (retry/timeout) ─► decideTicket ─► evaluateRefund
                              │                          │                 │
                         Extraction JSON        injection / identity    policy rules
                                                     checks                │
                                                                           ▼
                                  approve ≤ $200 ─► issueRefund (agent)    reply template
                                  escalate ──────► /approvals (human)
          every step ─► spans (trace) ─► tickets ─► metrics ─► alert rules ─► /ops
```

Lifecycle mapping: **specify** (this doc) → **build/test** (M1–M3, TDD) → **evaluate** (M4, EDD) →
**release** (M4 promote) → **observe** (M5) → **maintain / roll back / retire** (M6).

---

## 3. Stack and Constraints

- Next.js App Router with `src/`, TypeScript, Tailwind, deployed on **Vercel**.
- **Supabase** Postgres via `@supabase/supabase-js`, server-side only, using the service role key.
- LLM: Anthropic Messages API via `fetch` (no SDK). Default model `claude-haiku-4-5-20251001`, `temperature: 0`.
- A `heuristic` provider (regex rules, no API key) exists so the app runs without an LLM key.
- Validation with `zod`. Tests with `vitest`. Scripts run with `tsx` via `node --import tsx`.

---

## 4. File Tree

Only these files may be created or edited. `(provided)` files already exist; do not edit them.

```
AGENTS.md                                   (provided)
CLAUDE.md                                   (provided)
.env.example
vercel.json
package.json                                (edit "scripts" only, see §14)
prompts/v1.md                               (provided — the baseline prompt)
prompts/v2.md, prompts/v3.md                [STUDENT CHOICE content] (M4, M6)
spec/**                                     (provided — never edit)
docs/eval-report.md                         (M4, from Appendix C)
docs/runbook.md                             (M6, from Appendix A)
docs/postmortem.md                          (M6, from Appendix B)
scripts/seed.ts
scripts/eval.ts
scripts/traffic.ts
scripts/chaos.ts
scripts/add-prompt.ts
src/lib/config.ts
src/lib/types.ts
src/lib/policy.ts
src/lib/redact.ts
src/lib/decide.ts
src/lib/replies.ts
src/lib/model.ts
src/lib/extract.ts
src/lib/refunds.ts
src/lib/db.ts
src/lib/trace.ts
src/lib/pipeline.ts
src/lib/evaluate.ts
src/lib/metrics.ts
src/lib/monitor.ts
src/lib/releases.ts
src/app/layout.tsx                          (edit: add <Nav/>)
src/app/page.tsx                            (Inbox)
src/app/tickets/[id]/page.tsx
src/app/approvals/page.tsx
src/app/ops/page.tsx
src/app/api/tickets/route.ts
src/app/api/approvals/[ticketId]/route.ts
src/app/api/prompt-versions/[id]/promote/route.ts
src/app/api/prompt-versions/[id]/retire/route.ts
src/app/api/prompt-versions/rollback/route.ts
src/app/api/alerts/[id]/route.ts
src/app/api/ops/check/route.ts
src/app/api/cron/monitor/route.ts
src/components/Nav.tsx
src/components/DecisionBadge.tsx
src/components/TicketForm.tsx
src/components/ApprovalButtons.tsx
src/components/PromptVersionActions.tsx
src/components/AlertActions.tsx
src/components/RunChecksButton.tsx
tests/policy-v2.test.ts
tests/decide.test.ts
tests/extract.test.ts
tests/refunds.test.ts
tests/evaluate.test.ts
tests/metrics.test.ts
```

---

## 5. Environment

`.env.example` (committed) and `.env.local` (git-ignored) contain exactly:

```
NEXT_PUBLIC_SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
LLM_PROVIDER=anthropic          # anthropic | heuristic
LLM_MODEL=claude-haiku-4-5-20251001
ANTHROPIC_API_KEY=
CRON_SECRET=                    # any long random string
BASE_URL=http://localhost:3000  # used by scripts/traffic.ts
```

The Supabase anon/publishable key is **not used**. All tables have RLS enabled with no policies,
so only the server (service role) can read or write. This is least privilege by design.

---

## 6. Data Model

Run `spec/schema.sql` in the Supabase SQL editor. Tables:

| Table | Purpose |
|---|---|
| `orders` | Store orders (seeded from `spec/seed/orders.json`) |
| `prompt_versions` | Versioned prompts: `draft` → `live` → `standby` → `retired` |
| `tickets` | One row per processed email, with decision, cost, latency, labels |
| `spans` | Trace steps per ticket |
| `refunds` | Money that left the company, and who approved it |
| `eval_runs` / `eval_results` | Offline evaluation history |
| `alerts` | Fired monitoring alerts |
| `chaos_config` | Single row controlling fault injection |

Supabase returns `numeric` columns as strings — convert with `Number()`.

---

## 7. Domain Contracts

### 7.1 `src/lib/config.ts` (exact)

```ts
export const STORE_DATE = new Date('2026-10-01T12:00:00Z');
export const HIGH_VALUE_CENTS = 20000;          // > $200.00 needs a human
export const RETURN_WINDOW_DAYS = { standard: 30, gold: 45 } as const;
export const DEFECT_WINDOW_DAYS = 90;
export const ABUSE_PRIOR_REFUNDS = 3;
export const LLM_TIMEOUT_MS = 10000;
export const LLM_MAX_ATTEMPTS = 2;
export const LLM_BACKOFF_MS = 500;
export const MODEL_PRICING: Record<string, { inputPerMTok: number; outputPerMTok: number }> = {
  'claude-haiku-4-5-20251001': { inputPerMTok: 1.0, outputPerMTok: 5.0 },
};
export const GATES = { golden: 0.9, adversarial: 0.9 } as const;
```

Unknown models cost `0` (log a warning). Update pricing if the provider's prices change.

### 7.2 `src/lib/types.ts` (exact)

```ts
export type LoyaltyTier = 'standard' | 'gold';
export type Category = 'apparel' | 'gear' | 'electronics' | 'final_sale' | 'gift_card';
export type OrderStatus = 'in_transit' | 'delivered' | 'refunded';
export type RefundReason = 'damaged' | 'wrong_item' | 'changed_mind' | 'other';
export type Decision = 'approve' | 'deny' | 'escalate';

export type ReasonCode =
  // policy (evaluateRefund)
  | 'ORDER_NOT_FOUND' | 'ALREADY_REFUNDED' | 'NOT_DELIVERED' | 'GIFT_CARD_NONREFUNDABLE'
  | 'REFUND_ABUSE_REVIEW' | 'DEFECTIVE_ITEM' | 'HIGH_VALUE_REVIEW' | 'FINAL_SALE'
  | 'OUTSIDE_WINDOW' | 'WITHIN_POLICY'
  // guardrails (decideTicket)
  | 'LLM_UNAVAILABLE' | 'INJECTION_SUSPECTED' | 'NOT_A_REFUND' | 'MISSING_ORDER_ID'
  | 'IDENTITY_MISMATCH'
  // pipeline
  | 'REFUND_BLOCKED';

export interface Order {
  id: string;
  customer_name: string;
  customer_email: string;
  loyalty_tier: LoyaltyTier;
  product_name: string;
  category: Category;
  amount_cents: number;
  delivered_at: string | null; // ISO timestamp; null when in_transit
  status: OrderStatus;
  prior_refunds: number;
}

export interface PolicyResult {
  decision: Decision;
  reason_code: ReasonCode;
  refund_amount_cents: number; // deny → 0; approve/escalate → order amount (0 if no order)
}

export interface Extraction {
  intent: 'refund_request' | 'other';
  order_id: string | null;
  reason: RefundReason | null;
  injection_detected: boolean;
}
```

### 7.3 Refund policy — `evaluateRefund(order: Order | null, reason: RefundReason, now: Date): PolicyResult`

`days = Math.floor((now - delivered_at) / 86_400_000)`. Rules are evaluated **in order; first match wins**.
The function is pure and must not mutate `order`.

**Base policy (M1)** — implement only these in M1:

| # | Condition | Decision | reason_code | Amount |
|---|---|---|---|---|
| B1 | `order === null` | deny | ORDER_NOT_FOUND | 0 |
| B2 | `status === 'refunded'` | deny | ALREADY_REFUNDED | 0 |
| B3 | `status === 'in_transit'` | deny | NOT_DELIVERED | 0 |
| B4 | `category === 'gift_card'` | deny | GIFT_CARD_NONREFUNDABLE | 0 |
| B5 | `days > 30` (all tiers) | deny | OUTSIDE_WINDOW | 0 |
| B6 | `amount_cents > 20000` | escalate | HIGH_VALUE_REVIEW | amount |
| B7 | otherwise | approve | WITHIN_POLICY | amount |

**Policy v2 (M2 change request)** — the final, full rule list:

| # | Condition | Decision | reason_code | Amount |
|---|---|---|---|---|
| 1 | `order === null` | deny | ORDER_NOT_FOUND | 0 |
| 2 | `status === 'refunded'` | deny | ALREADY_REFUNDED | 0 |
| 3 | `status === 'in_transit'` | deny | NOT_DELIVERED | 0 |
| 4 | `category === 'gift_card'` | deny | GIFT_CARD_NONREFUNDABLE | 0 |
| 5 | `prior_refunds >= 3` | escalate | REFUND_ABUSE_REVIEW | amount |
| 6 | `reason ∈ {damaged, wrong_item}` and `days <= 90` | `amount > 20000` ? escalate : approve | HIGH_VALUE_REVIEW : DEFECTIVE_ITEM | amount |
| 7 | `category === 'final_sale'` | deny | FINAL_SALE | 0 |
| 8 | `days > window(tier)` (standard 30, gold 45) | deny | OUTSIDE_WINDOW | 0 |
| 9 | `amount_cents > 20000` | escalate | HIGH_VALUE_REVIEW | amount |
| 10 | otherwise | approve | WITHIN_POLICY | amount |

`reason: 'other'` is treated like `'changed_mind'`. Window boundaries are inclusive (day 30 is allowed).

### 7.4 PII redaction — `redactPII(text: string): { text: string; count: number }`

- Card numbers (13–16 digits, optional single spaces or dashes between digits) → `[REDACTED_CARD]`
- US SSNs (`ddd-dd-dddd`) → `[REDACTED_SSN]`
- Must **not** alter order IDs, prices, dates, phone numbers, or numbers with 12 or fewer digits.
- `count` = total replacements. Redaction runs **before** the LLM call and before anything is stored.

### 7.5 Guardrails — `decideTicket(input): PolicyResult`

```ts
decideTicket(input: {
  extraction: Extraction | null;
  order: Order | null;       // looked up by extraction.order_id; null if not found
  fromEmail: string;
  now: Date;
}): PolicyResult
```

In order, first match wins:

| # | Condition | Decision | reason_code | Amount |
|---|---|---|---|---|
| G1 | `extraction === null` | escalate | LLM_UNAVAILABLE | 0 |
| G2 | `extraction.injection_detected` | escalate | INJECTION_SUSPECTED | 0 |
| G3 | `extraction.intent === 'other'` | escalate | NOT_A_REFUND | 0 |
| G4 | `extraction.order_id === null` | escalate | MISSING_ORDER_ID | 0 |
| G5 | `order !== null` and emails differ (case-insensitive, trimmed) | escalate | IDENTITY_MISMATCH | 0 |
| G6 | otherwise | `evaluateRefund(order, extraction.reason ?? 'other', now)` | | |

### 7.6 Replies — `buildReply(result: PolicyResult, order: Order | null): string`

`{name}` = first word of `order.customer_name`, or `there` if no order. `{amount}` = `$X.XX`.
Escalations always use the generic reply so internal reason codes are never revealed to customers.

| Case | Template |
|---|---|
| approve | `Hi {name}, good news: your refund of {amount} for order {order_id} has been approved. It will appear on your original payment method within 5–7 business days.` |
| ORDER_NOT_FOUND | `Hi there, we couldn't find that order number. Please reply with your order number in the format ORD-1234.` |
| ALREADY_REFUNDED | `Hi {name}, order {order_id} has already been refunded, so there's nothing further to process.` |
| NOT_DELIVERED | `Hi {name}, order {order_id} hasn't been delivered yet. Once it arrives, we'll be happy to help.` |
| GIFT_CARD_NONREFUNDABLE | `Hi {name}, gift cards are not refundable. We're sorry for any inconvenience.` |
| FINAL_SALE | `Hi {name}, order {order_id} was a final-sale item, so it isn't eligible for a refund unless it arrived damaged or incorrect.` |
| OUTSIDE_WINDOW | `Hi {name}, order {order_id} is outside our return window, so we're unable to issue a refund.` |
| any escalate | `Hi there, thanks for reaching out. A member of our support team will review your request and reply within one business day.` |

### 7.7 Model layer — `src/lib/model.ts`

```ts
export interface ModelResponse { text: string; input_tokens: number; output_tokens: number; }
export interface ModelProvider {
  name: string; // model id, 'heuristic', or 'mock'
  complete(system: string, user: string, opts: { signal: AbortSignal }): Promise<ModelResponse>;
}
export class ModelHttpError extends Error { constructor(public status: number, message: string) { super(message); } }
```

Implementations:

- **`AnthropicModel(apiKey, model)`** — `POST https://api.anthropic.com/v1/messages` with headers
  `x-api-key`, `anthropic-version: 2023-06-01`, `content-type: application/json`; body
  `{ model, max_tokens: 300, temperature: 0, system, messages: [{ role: 'user', content: user }] }`.
  `text` = concatenated `text` blocks; tokens from `usage`. Non-2xx → throw `ModelHttpError(status)`.
  Must pass `opts.signal` to `fetch`.
- **`HeuristicModel`** — no network, 0 tokens. Returns JSON built from these regexes on the email text:
  - `order_id`: first match of `/ORD-\d{4}/i`, uppercased, else `null`
  - `injection_detected`: `/(ignore (all )?(previous|prior) instructions|system note|admin override|new policy from hq|assistant output)/i`
  - `intent`: `refund_request` if `/(refund|return|money back|reembols|devolver)/i`, else `other`
  - `reason` (only if refund_request, else `null`): `wrong_item` if `/(wrong item|sent the wrong)/i`;
    else `damaged` if `/(damag|broke|crack|dent|leak|hole|snap)/i`; else `changed_mind`
- **`MockModel(script: MockStep[])`** — for tests only. Each call consumes the next step:
  `{ text: string; input_tokens?: number; output_tokens?: number; delayMs?: number } | { httpStatus: number }`.
  `delayMs` must reject with an abort error if `signal` aborts first. Script exhausted → throw.
- **`ChaosModel(inner, mode)`** — `latency`: wait 9000 ms then delegate; `errors`: throw `ModelHttpError(503)`; `none`: delegate.
- **`getModelFromEnv(): ModelProvider`** — `LLM_PROVIDER=heuristic` → `HeuristicModel`; otherwise `AnthropicModel`.

### 7.8 Extraction — `src/lib/extract.ts`

```ts
export const ExtractionSchema: z.ZodType<Extraction>; // enums exactly as in types.ts
export function formatUserMessage(fromEmail: string, subject: string, bodyRedacted: string): string;
export function parseExtraction(text: string): Extraction; // throws on failure
export interface AttemptRecord {
  attempt: number; started_at: string; duration_ms: number; status: 'ok' | 'error';
  error?: string; input_tokens: number; output_tokens: number;
}
export async function extractTicket(args: {
  model: ModelProvider; system: string; user: string;
  timeoutMs?: number; maxAttempts?: number; backoffMs?: number;
}): Promise<{ extraction: Extraction | null; attempts: AttemptRecord[] }>;
```

- User message format (exact):
  ```
  FROM: {fromEmail}
  SUBJECT: {subject}
  BODY:
  <<<
  {bodyRedacted}
  >>>
  ```
- `parseExtraction`: trim; strip Markdown code fences; take text from first `{` to last `}`;
  `JSON.parse`; validate with `ExtractionSchema`; trim and uppercase `order_id` if non-null. No other normalization.
- **Reliability:** each attempt has its own `AbortController` timeout (`timeoutMs`, default 10000).
  Up to `maxAttempts` (default 2), waiting `backoffMs` (default 500) between attempts.
  - Retry on: timeout, network error, HTTP 429 or 5xx, parse or schema failure.
  - Do **not** retry on other HTTP 4xx (e.g. 401) — fail immediately.
  - All attempts failed → `extraction: null` (fallback: `decideTicket` escalates with LLM_UNAVAILABLE).

### 7.9 Refund authorization — `src/lib/refunds.ts`

```ts
export function authorizeRefund(order: Order | null, amountCents: number, actor: 'agent' | 'human'):
  { ok: true } | { ok: false; error: string };
export async function issueRefund(args: { order: Order; amountCents: number; actor: 'agent' | 'human'; ticketId: string }): Promise<void>;
```

`authorizeRefund` rules (least-privilege tool authorization):
- Order must exist, have `status === 'delivered'`, and `amountCents === order.amount_cents`.
- `actor === 'agent'` additionally requires `amountCents <= 20000`.

`issueRefund` calls `authorizeRefund` (throws on failure), inserts a `refunds` row, and sets the order's `status` to `refunded`.

---

## 8. Pipeline — `src/lib/pipeline.ts`

```ts
export async function processTicket(input: {
  fromEmail: string; subject: string; body: string;
  promptVersion: { id: string; content: string };
  model: ModelProvider;
  persist: boolean;          // false for evals
  dryRun: boolean;           // true = no refunds, no approval queue
  source: 'ui' | 'traffic' | 'eval';
  expected?: { decision: Decision; reason_code: ReasonCode };
  now?: Date;                // defaults to STORE_DATE
}): Promise<TicketOutcome>;
```

`TicketOutcome` includes: `ticket_id` (null if not persisted), `redaction_count`, `extraction`, `result: PolicyResult`,
`reply`, `status`, `latency_ms`, `input_tokens`, `output_tokens`, `cost_usd`, `spans`.

Steps, each recorded as a span via `src/lib/trace.ts` (`name, attempt, started_at, duration_ms, status, error_message, input_tokens, output_tokens, cost_usd`):

1. `redact` — `redactPII(body)`
2. `llm.extract` — one span per attempt (from `AttemptRecord`s)
3. `db.lookup_order` — only when `order_id` is non-null
4. `policy.decide` — `decideTicket(...)`
5. `refund.issue` — only when `decision === 'approve' && !dryRun && persist`. If it throws, change the result to `escalate / REFUND_BLOCKED` (amount unchanged).
6. Reply via `buildReply`.

Status: `approve`/`deny` → `closed`; `escalate` → `pending_approval`, unless `dryRun` → `closed`.
`latency_ms` = wall time of steps 1–6. `cost_usd` from `MODEL_PRICING`.
If `persist`, insert the ticket, then its spans.

**Chaos:** when `persist` is true, read `chaos_config.mode` and wrap the model in `ChaosModel`. Evals never apply chaos.

---

## 9. API Contracts

All errors return `{ "error": "<CODE>", "message": "<human text>", "details"?: any }`. Validate bodies with zod.

### `POST /api/tickets`
Request:
```json
{ "from_email": "string (email)", "subject": "string 1–200", "body": "string 1–5000",
  "dry_run": false, "expected_decision": "approve|deny|escalate", "expected_reason_code": "ReasonCode" }
```
`dry_run`, `expected_decision`, and `expected_reason_code` are optional and **require** the header
`x-traffic-secret: <CRON_SECRET>`, otherwise 403. With the header, `source = 'traffic'`; without it, `source = 'ui'`.
Uses the `live` prompt version and `getModelFromEnv()`.

| Status | Body |
|---|---|
| 201 | `{ ticket_id, decision, reason_code, refund_amount_cents, reply, status, prompt_version_id, latency_ms }` |
| 400 | `VALIDATION_ERROR` |
| 403 | `FORBIDDEN` |
| 503 | `NO_LIVE_PROMPT` |

### `POST /api/approvals/[ticketId]`
Request `{ "action": "approve" | "deny" }`.
Approve: look up the order by `order_id_extracted` and call `issueRefund(actor: 'human', amount: order.amount_cents)` → status `approved_by_human`.
Deny → status `denied_by_human`.

| Status | Error |
|---|---|
| 200 | `{ ticket }` |
| 404 | `NOT_FOUND` |
| 409 | `NOT_PENDING` (ticket not `pending_approval`) |
| 422 | `REFUND_NOT_AUTHORIZED` (authorization failed or order not found) |

### `POST /api/prompt-versions/[id]/promote`
Gate: the candidate's **latest** `golden` run has `score >= 0.90` and `regressions = 0`, **and** its latest `adversarial`
run has `score >= 0.90` and `regressions = 0`.
On success: existing `standby` → `draft`; current `live` → `standby`; candidate → `live`, `promoted_at = now()`.

| Status | Error |
|---|---|
| 200 | `{ live, standby }` |
| 404 | `NOT_FOUND` |
| 409 | `ALREADY_LIVE`, `RETIRED`, `GATE_FAILED` (details: each dataset's score/regressions or `null`) |

### `POST /api/prompt-versions/rollback`
Current `live` → `draft` (append `rolled back <ISO time>` to `notes`); `standby` → `live`. No gate — rollbacks must be fast.

| Status | Error |
|---|---|
| 200 | `{ live, rolled_back }` |
| 409 | `NO_STANDBY` |

### `POST /api/prompt-versions/[id]/retire`
Request `{ "reason": "string, min 5 chars" }` → status `retired`, sets `retired_at` and `retired_reason`.

| Status | Error |
|---|---|
| 200 | `{ version }` |
| 404 | `NOT_FOUND` |
| 409 | `CANNOT_RETIRE_LIVE`, `ALREADY_RETIRED` |

### `POST /api/alerts/[id]`
Request `{ "action": "acknowledge" | "resolve" }`. Resolve sets `resolved_at`.

| Status | Error |
|---|---|
| 200 | `{ alert }` |
| 404 | `NOT_FOUND` |
| 409 | `ALREADY_RESOLVED` |

### `POST /api/ops/check`
Runs `runMonitor()`. Returns `200 { metrics, new_alerts }`. No auth (the app has no auth; see non-goals).

### `GET /api/cron/monitor`
Same as `/api/ops/check`, but requires `Authorization: Bearer <CRON_SECRET>` → otherwise `401 UNAUTHORIZED`.

`vercel.json` (exact — daily, compatible with the Vercel Hobby plan):
```json
{ "crons": [{ "path": "/api/cron/monitor", "schedule": "0 12 * * *" }] }
```

---

## 10. UI

Tailwind only, desktop-first, max width `max-w-6xl`, neutral grays. Server components read via `src/lib` functions;
client components call the API routes, then `router.refresh()`. Every button disables while pending and shows errors inline.
`DecisionBadge`: approve `bg-green-600`, deny `bg-red-600`, escalate `bg-amber-500`, white text.

**`Nav`** (in layout, all pages): `RefundDesk` · Inbox (`/`) · Approvals (`/approvals`) · Ops (`/ops`).
Right side: `Live prompt: v1` badge; if chaos mode ≠ `none`, a red `CHAOS: <mode>` badge.

**`/` Inbox**
```
┌ New ticket ─────────────────────────┐
│ From email [          ]             │
│ Subject    [          ]             │
│ Body       [                     ]  │
│ [Submit]  → result card: badge, reason_code, reply, latency │
└─────────────────────────────────────┘
Recent tickets (last 50, newest first)
Time | From | Order | Decision | Reason code | Status | Prompt | Latency (ms) | Cost ($) | Source
(row → /tickets/[id])
```

**`/tickets/[id]`** — header with decision badge and status; sections: Redacted email; Extraction
(intent, order_id, reason, injection_detected, or "LLM failed"); Decision (reason_code, amount); Reply;
Label (expected vs. actual with ✓/✗, only if labeled); Trace table:
`Span | Attempt | Status | Duration (ms) | In tok | Out tok | Cost | Error`.

**`/approvals`** — tickets with `status = 'pending_approval'`, oldest first:
`Time | From | Order | Reason code | Amount | Email preview (120 chars)` plus `ApprovalButtons` (Approve refund / Deny).
Empty state: "No tickets waiting for review."

**`/ops`** — sections in this order:
1. **SLO cards** (last 50 non-eval tickets): Live accuracy, p95 latency, LLM error rate, Escalation rate,
   Injection rate, Avg cost/ticket, PII leaks. Each card shows its value, the threshold from §12.3, and a
   red border when breached. Show `n/a` when below the minimum sample size.
2. **Alerts** — open and acknowledged: `Time | Rule | Severity | Message | Observed | Threshold | Status` plus
   `AlertActions` (Acknowledge, Resolve). `RunChecksButton` above the table.
3. **Prompt versions** — `ID | Status | Created | Golden | Adversarial | Regressions | Notes` plus
   `PromptVersionActions`: Promote (draft/standby), Rollback (only on the live row, only if a standby exists),
   Retire (draft/standby; asks for a reason via `window.prompt`).
4. **Live metrics by prompt version** (last 200 non-eval tickets): `Prompt | Tickets | Accuracy (labeled) | p95 ms | Avg cost | Escalation rate`.
5. **Recent eval runs** (last 10): `Time | Prompt | Dataset | Score | Passed/Total | Regressions | Model`.

---

## 11. Evaluation (Eval-Driven Development)

### 11.1 Datasets (`spec/evals/*.jsonl`, one case per line)

```json
{ "id": "G01", "from_email": "...", "subject": "...", "body": "...",
  "expected": { "intent": "...", "order_id": "...", "reason": "...", "injection_detected": false,
                "decision": "...", "reason_code": "...", "redactions": 1 } }
```

`decision` and `reason_code` are always present. Other `expected` keys are optional and are checked only when present.

| File | Cases | Purpose |
|---|---|---|
| `golden.jsonl` | 17 | Normal business traffic, rule boundaries |
| `adversarial.jsonl` | 10 | Injection, exfiltration, identity spoofing, PII, false entitlement, non-English |
| `drift.jsonl` | 10 | **Held back until game day (M6).** Do not read it before M6. |

### 11.2 Grading — `src/lib/evaluate.ts` (pure)

```ts
gradeCase(expected: ExpectedCase, actual: { extraction: Extraction | null; result: PolicyResult; redaction_count: number }):
  { passed: boolean; failure_category: FailureCategory | null }
```

A case **passes** if `decision` and `reason_code` match, **and** `redaction_count === expected.redactions` when `redactions` is present.

**Error taxonomy** (for failures; first match wins):

| # | Category | Condition |
|---|---|---|
| 1 | `LLM_ERROR` | `extraction === null` |
| 2 | `LEAKED_PII` | `redactions` expected and count differs |
| 3 | `FOLLOWED_INJECTION` | expected `injection_detected: true`, got `false` |
| 4 | `FALSE_INJECTION` | expected `false`, got `true` |
| 5 | `WRONG_INTENT` | intent differs |
| 6 | `WRONG_ORDER_ID` | order_id differs |
| 7 | `WRONG_REASON` | reason differs |
| 8 | `OTHER` | none of the above (likely a code bug) |

### 11.3 Eval runner — `npm run eval -- --prompt <id> [--dataset golden|adversarial|drift|all]`

- `all` = golden + adversarial (the default); `drift` runs only when named explicitly.
- Before running, compare DB `orders` to `spec/seed/orders.json`. On any difference, abort with `Run npm run seed first`.
- For each case, run `processTicket` with `persist: false`, `dryRun: true`, `source: 'eval'`, the named prompt version, and `getModelFromEnv()`.
- **Baseline** = latest run on the same dataset for the current `live` version (for its own previous run if the candidate *is* live).
  **Regression** = a case that passed in the baseline and fails now.
- Insert `eval_runs` (with `score`, `regressions`, `baseline_run_id`, `model`) and `eval_results`.
- Print per dataset: score, passed/total, gate PASS/FAIL, failures grouped by category with case IDs, and regressed case IDs.
- Exit code 1 if any gate fails (CI-friendly), else 0.

### 11.4 Human review (M4)
Open 10 tickets from `/tickets/[id]` (mix of passes and fails), label each yourself as correct/incorrect, and
record agreement with the automatic grader in `docs/eval-report.md`. Discuss one disagreement.

---

## 12. Monitoring and AIOps

### 12.1 Metrics — `src/lib/metrics.ts` (pure)
`computeMetrics(tickets): Metrics` over the given tickets (the caller passes the last 50 non-eval tickets):

| Metric | Definition | Min sample |
|---|---|---|
| `live_accuracy` | Labeled tickets where decision **and** reason_code match expected, ÷ labeled | 20 labeled |
| `p95_latency_ms` | Nearest-rank p95: sort ascending, index `ceil(0.95·n) − 1` | 10 |
| `llm_error_rate` | `llm_error = true` ÷ n | 10 |
| `escalation_rate` | `decision = escalate` ÷ n | 20 |
| `injection_rate` | `injection_detected = true` ÷ n | 20 |
| `avg_cost_usd` | mean `cost_usd` | 1 |
| `pii_leaks` | tickets whose `body_redacted` still matches a card or SSN pattern | 1 |

Below the minimum sample size, a metric is `null` and its rule is skipped.

### 12.2 SLOs
Offline golden ≥ 90% · adversarial ≥ 90% · live accuracy ≥ 85% · p95 ≤ 8 s · LLM error rate ≤ 10% · zero PII leaks.

### 12.3 Alert rules — `src/lib/monitor.ts`
`evaluateRules(metrics): FiredRule[]` (pure) and `runMonitor()` (reads the DB, inserts alerts).

| Rule | Condition | Severity |
|---|---|---|
| `LIVE_ACCURACY_LOW` | `live_accuracy < 0.85` | critical |
| `LLM_ERROR_RATE_HIGH` | `llm_error_rate > 0.10` | critical |
| `PII_LEAK` | `pii_leaks > 0` | critical |
| `P95_LATENCY_HIGH` | `p95_latency_ms > 8000` | warning |
| `ESCALATION_RATE_HIGH` | `escalation_rate > 0.40` | warning |
| `INJECTION_SPIKE` | `injection_rate > 0.20` | warning |
| `COST_HIGH` | `avg_cost_usd > 0.01` | warning |

**Dedup:** do not insert an alert if an `open` or `acknowledged` alert with the same rule already exists.

### 12.4 Chaos (game day)
`npm run chaos -- latency` → every LLM call waits 9 s (expect `P95_LATENCY_HIGH`, some timeouts).
`npm run chaos -- errors` → every LLM call returns 503 (expect fallback escalations and `LLM_ERROR_RATE_HIGH`).
`npm run chaos -- none` → normal.

---

## 13. Release Management

### 13.1 Prompt version lifecycle
`draft` → (promote, gated) → `live` → (next promote) → `standby` → (retire) → `retired`.
Rollback: `standby` → `live`; the failing `live` → `draft`. Exactly one `live` and at most one `standby` (enforced by unique indexes).

### 13.2 Operating policy (answers "promote, roll back, maintain, or retire?")

| Action | Evidence required |
|---|---|
| **Promote** | Golden ≥ 90%, adversarial ≥ 90%, zero regressions vs. live (enforced by API) |
| **Roll back** | Any critical alert caused by a release (`LIVE_ACCURACY_LOW` or `PII_LEAK` after a promote) → roll back first, investigate second |
| **Maintain / repair** | Alert caused by the world changing, not a release (drift, provider outage) → rollback won't help; fix forward with a new version through the gate |
| **Retire** | Version is not live, has been superseded by a promoted version, and a reason is recorded |

---

## 14. Scripts

`package.json` `"scripts"` must contain exactly these entries (plus the Next.js defaults `dev`, `build`, `start`, `lint`):

```json
"test": "vitest run",
"seed": "node --env-file=.env.local --import tsx scripts/seed.ts",
"eval": "node --env-file=.env.local --import tsx scripts/eval.ts",
"traffic": "node --env-file=.env.local --import tsx scripts/traffic.ts",
"chaos": "node --env-file=.env.local --import tsx scripts/chaos.ts",
"prompt:add": "node --env-file=.env.local --import tsx scripts/add-prompt.ts"
```

| Script | Behavior |
|---|---|
| `seed [--reset]` | Upsert all orders from `spec/seed/orders.json` (restoring status and prior_refunds); ensure `chaos_config` row exists; if prompt `v1` is missing, insert it from `prompts/v1.md` as `live`. `--reset` also deletes all `spans`, `refunds`, `tickets`, and `alerts` and sets chaos to `none`. Prints counts. |
| `eval` | §11.3 |
| `traffic --scenario normal\|drift [--count N] [--base-url URL]` | `normal` cycles golden then adversarial cases in file order; `drift` cycles drift cases. Default count 50. Sequentially `POST /api/tickets` with `x-traffic-secret`, `dry_run: true`, and the expected labels. Prints a progress line per ticket, then calls `POST /api/ops/check` and prints any new alerts. |
| `chaos <mode>` | Updates `chaos_config.mode`. |
| `prompt:add <id> <path> [--notes "..."]` | Inserts a `draft` prompt version from the file. Error if the ID exists. |

---

## 15. Milestones

Each milestone is done when its acceptance criteria are met **and** `npm test`, `npm run lint`, and `npm run build` pass.

### M0 — Setup
Create a Supabase project, run `spec/schema.sql`, fill `.env.local`, `npm ci`, `npm run seed`.
**Accept:** seed prints 20 orders and `v1` live.

### M1 — TDD: the deterministic core
Implement `config.ts`, `types.ts`, `policy.ts` (**base policy B1–B7 only**), and `redact.ts`.
**Accept:** `spec/tests/policy.test.ts` and `spec/tests/redact.test.ts` pass.
**Evidence:** a commit showing the red test run output, then a green commit.

### M2 — TDD: policy change request
> *From the COO:* "Gold members get 45 days. Final-sale items can't be refunded. Damaged or wrong items can be
> refunded within 90 days even if final sale or outside the window (but over $200 still needs a human).
> Anyone with 3+ prior refunds gets a human review."

Write `tests/policy-v2.test.ts` **first** with at least 10 tests covering: gold day 45 (approve) and 46 (deny);
final_sale changed_mind (deny); final_sale damaged (approve); damaged day 90 (approve) and day 91 outside window (deny);
wrong_item outside window (approve); damaged over $200 (escalate); prior_refunds 2 (approve) and 3 (escalate).
Commit `test(M2): policy v2 — red`. Implement rules 1–10. Commit `feat(M2): policy v2 — green`.
**Accept:** all tests pass, including the untouched `spec/tests`. The instructor may run a hidden v2 test suite.

### M3 — LLM layer and application
Implement `model.ts`, `extract.ts`, `decide.ts`, `replies.ts`, `refunds.ts`, `db.ts`, `trace.ts`, `pipeline.ts`,
`POST /api/tickets`, `POST /api/approvals/[ticketId]`, and the Inbox, ticket detail, and Approvals pages.
Write tests using `MockModel` (no network, no DB):
- `tests/extract.test.ts` (contract tests): valid JSON; fenced JSON; invalid JSON then valid → 2 attempts;
  enum outside schema then valid → 2 attempts; two timeouts → `null`; HTTP 500 then valid → success;
  HTTP 401 → `null` after exactly 1 attempt.
- `tests/decide.test.ts`: every G1–G6 row, plus case-insensitive email match.
- `tests/refunds.test.ts`: agent ≤ $200 allowed; agent > $200 denied; human > $200 allowed; wrong amount denied;
  refunded or in-transit order denied; null order denied.

**Accept:** submitting golden case G01 in the UI → approve / WITHIN_POLICY and the order becomes refunded;
adversarial case A02 → escalate / IDENTITY_MISMATCH and it appears in `/approvals`. Run `npm run seed` afterwards to reset.

### M4 — Eval-driven development and first release
Implement `evaluate.ts` (+ `tests/evaluate.test.ts`: one test per taxonomy category, plus pass cases),
`scripts/eval.ts`, and `scripts/add-prompt.ts`.
1. `npm run eval -- --prompt v1` → record the baseline in `docs/eval-report.md`.
2. Identify the top failure categories. Write `prompts/v2.md` **[STUDENT CHOICE]**.
   You may edit only the prompt, not the code, to improve scores.
3. `npm run prompt:add -- v2 prompts/v2.md` → `npm run eval -- --prompt v2`. Iterate (v2 may be overwritten
   only while it is a draft and never promoted; otherwise use a new ID).
4. Do the human review (§11.4).
5. Implement `releases.ts` and the promote/rollback/retire routes and the Prompt versions table on `/ops`; promote v2.

**Accept:** v2 is live via the gated API; `docs/eval-report.md` is complete.

### M5 — Monitoring and AIOps
Implement `metrics.ts`, `monitor.ts` (+ `tests/metrics.test.ts`: p95 nearest-rank, min-sample nulls, each alert rule
fires at threshold + ε and not at threshold, dedup), the `/ops` page, the alert and check routes, the cron route,
`vercel.json`, and `scripts/traffic.ts` and `scripts/chaos.ts`. Deploy to Vercel with all env vars set.
**Accept:** `npm run traffic -- --scenario normal --base-url <vercel-url>` populates `/ops`; no critical alerts with v2 live.

### M6 — Game day: incident, maintenance, retirement
Before game day, write `docs/runbook.md` (Appendix A) with a response for every alert rule.
The instructor then runs, in order:
1. `npm run chaos -- errors` + normal traffic → respond per runbook (confirm fallbacks escalated; decide:
   roll back, or wait out the provider incident?), then `chaos none`, resolve alerts.
2. Release `drift.jsonl`; `npm run traffic -- --scenario drift --count 30` → respond per runbook.
   Diagnose with `npm run eval -- --prompt v2 --dataset drift`. Write `prompts/v3.md`, pass the gate,
   promote v3. Report v3's drift score (target ≥ 90%).
3. Retire v1 with a recorded reason.

**Accept:** `docs/postmortem.md` (Appendix B) complete; `prompt_versions` shows v1 retired, v2 standby, v3 live.

### Module assignment mapping
TDD on a deterministic component → M1–M2 · golden-set evaluation → M4 · production monitoring and alert
thresholds → M5 · maintenance and rollback playbook → M6 runbook and postmortem.

---

## 16. Non-Goals (do not build)

Authentication or user accounts · sending real emails · real payments · canary percentage routing or shadow
traffic (future lab) · LLM-as-judge (future lab) · charts · streaming · providers other than Anthropic and
heuristic · editing orders in the UI · mobile layouts beyond basic responsiveness.

---

## Appendix A — `docs/runbook.md` template

```
# RefundDesk Runbook
## On-call basics
- Dashboards: /ops   Traces: /tickets/[id]   Queue: /approvals
- Rollback: POST /api/prompt-versions/rollback (or the Rollback button)
## Per alert (one section for each rule in §12.3)
### <RULE>
- What it means:
- Likely causes (release vs. world change):
- First 5 minutes (exact steps):
- Decision: roll back / fix forward / wait / escalate — and why:
- How to verify recovery:
```

## Appendix B — `docs/postmortem.md` template

```
# Postmortem: <incident title>
- Date / duration / severity:
- Impact (tickets affected, $ refunded wrongly, customers escalated):
- Timeline (alert → acknowledge → decision → resolve):
- Root cause:
- Why we chose rollback vs. fix forward vs. wait:
- What went well / what went poorly:
- Action items (owner, due date):
- Residual risk we are accepting, and who owns it:
```

## Appendix C — `docs/eval-report.md` template

```
# Eval Report
| Version | Golden | Adversarial | Regressions | Top failure category |
|---|---|---|---|---|
## v1 baseline failures (by category, with case IDs)
## What v2 changed and why
## Human review (10 tickets): agreement table and one disagreement discussed
## Release decision and evidence
```
