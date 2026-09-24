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
.github/workflows/ci.yml                  (M7, see §17.6)
package.json                                (edit "scripts" only, see §14)
README.md                                   (developer overview; update after every milestone)
GUIDE.md                                    (M7: run/demo guide + teaching reference, see §17.5)
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
scripts/demo.ts                             (M7, see §17.1)
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
src/lib/explain.ts                           (M7, see §17.3)
src/lib/diff.ts                              (M7, pure line diff for /prompts)
src/lib/samples.ts                           (M7, curated emails for /simulate)
src/app/layout.tsx                          (edit: theme script, sidebar shell)
src/app/globals.css                         (edit: theme tokens only)
src/app/page.tsx                            (Inbox)
src/app/tickets/[id]/page.tsx
src/app/approvals/page.tsx
src/app/ops/page.tsx
src/app/dashboard/page.tsx                 (M7, see §10.4)
src/app/prompts/page.tsx                   (M7, see §10.4)
src/app/simulate/page.tsx                  (M7, see §10.4)
src/app/lifecycle/page.tsx                  (M7, see §17.4)
src/app/safety/page.tsx                     (M7, see §17.4)
src/app/api/tickets/route.ts
src/app/api/approvals/[ticketId]/route.ts
src/app/api/prompt-versions/[id]/promote/route.ts
src/app/api/prompt-versions/[id]/retire/route.ts
src/app/api/prompt-versions/rollback/route.ts
src/app/api/alerts/[id]/route.ts
src/app/api/ops/check/route.ts
src/app/api/simulate/route.ts               (M7, see §9)
src/app/api/cron/monitor/route.ts
src/components/Nav.tsx
src/components/DecisionBadge.tsx
src/components/TicketForm.tsx
src/components/ApprovalButtons.tsx
src/components/PromptVersionActions.tsx
src/components/AlertActions.tsx
src/components/RunChecksButton.tsx
src/components/NavLinks.tsx                 (client: active-link highlight)
src/components/ThemeToggle.tsx              (client: dark/light switch)
src/components/PageHeader.tsx               (title + description)
src/components/ClickableRow.tsx             (client: table row that navigates)
src/components/charts.tsx                   (hand-built SVG/Tailwind charts)
src/components/SimulatorPanel.tsx           (client: /simulate buttons and results)
tests/policy-v2.test.ts
tests/decide.test.ts
tests/extract.test.ts
tests/refunds.test.ts
tests/evaluate.test.ts
tests/metrics.test.ts
tests/explain.test.ts
tests/diff.test.ts
components.json                             (provided)
src/lib/utils.ts                            (provided — shadcn)
src/components/ui/**                        (provided — shadcn, never edit)
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

### `POST /api/simulate` (M7)
Request `{ "sample_id": "string" }` where the id is one of the curated samples in `src/lib/samples.ts` (ids of golden/adversarial cases such as `G01`, `A02`; never `drift`).
Runs that sample through `processTicket` with the live prompt and `getModelFromEnv()`, `persist: true`, **`dryRun: true`**, `source: 'traffic'` and the sample's expected labels (so no refunds move, and live-accuracy metrics update).
Only known ids are accepted, so the endpoint cannot send arbitrary text to the LLM. No auth (§16).
| Status | Body |
|---|---|
| 201 | `{ sample_id, ticket_id, decision, reason_code, expected_decision, expected_reason_code, match, reply, prompt_version_id, latency_ms }` |
| 400 | `VALIDATION_ERROR` |
| 404 | `NOT_FOUND` (unknown sample) |
| 503 | `NO_LIVE_PROMPT` |

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

Use shadcn/ui components from `src/components/ui/` plus Tailwind utilities. Do not add, remove,
or regenerate shadcn components, do not run the shadcn CLI, and do not add UI, theme or chart **libraries**.
Desktop-first, content `max-w-6xl`, and it must work down to phone width (the sidebar stacks above the content below `md`).

**Component mapping (exact):**
- Page sections and SLO cards → `Card` (`CardHeader`, `CardTitle`, `CardContent`)
- All tables → `Table`. Rows that open a ticket use `ClickableRow` (a `TableRow` that navigates; links and buttons inside still work)
- Forms → `Label` + `Input` / `Textarea`; actions → `Button` (primary actions default variant,
  Deny/Retire/Rollback use `variant="destructive"`, secondary actions `variant="outline"`)
- Inline errors, notices and the approvals empty state → `Alert`
- `DecisionBadge` → `Badge` with className: approve `bg-green-600`, deny `bg-red-600`, escalate `bg-amber-500`, white text
- Status, severity, and prompt-version labels → `Badge variant="outline"`; critical severity and breached SLO cards → `border-red-600`

### 10.1 Theme
- **Dark is the default.** No theme library. `layout.tsx` puts class `dark` on `<html>` (with `suppressHydrationWarning`) and an inline
  `<script>` in `<head>` that runs before paint: `localStorage['theme'] === 'light'` removes `dark`, anything else (or blocked storage) keeps it.
- `ThemeToggle` (client) reads the `<html>` class via `useSyncExternalStore` + `MutationObserver`, toggles the class and writes `localStorage['theme']` (in try/catch).
  Button text: `Light theme` while dark, `Dark theme` while light; `aria-label="Switch to <other> theme"`.
- Tokens live in `globals.css` (`:root` light, `.dark` dark). Accent (`--primary`) is indigo (`oklch(0.5 0.2 265)` light, `oklch(0.65 0.19 265)` dark);
  dark surfaces are slightly blue (`--background oklch(0.16 0.012 265)`, `--card oklch(0.21 0.014 265)`). `--font-sans` must point at `var(--font-geist-sans)`.
- Never hard-code light-only colors; use tokens (`bg-background`, `text-muted-foreground`, `bg-primary`, ...). Semantic colors (green/red/amber) are allowed.

### 10.2 Shell and `Nav`
- `layout.tsx`: `<div class="flex min-h-screen flex-col md:flex-row">` containing `<Nav/>` then `<main class="min-w-0 flex-1 px-4 py-8 md:px-8">` with an inner `mx-auto max-w-6xl`.
- `Nav` (server component) is a **vertical sidebar**: `aside` `md:sticky md:top-0 md:h-screen md:w-60 md:border-r bg-sidebar`. Top to bottom:
  logo (`R` tile + `RefundDesk`), `NavLinks` (client, `usePathname`, active link highlighted `bg-primary/15 text-primary`, inline SVG icons, no icon library),
  then pinned to the bottom: red `CHAOS: <mode>` badge if chaos ≠ `none`, `Live prompt: <id>` outline badge, `ThemeToggle`.
- **Every page that renders `Nav` must be dynamic** (`export const dynamic = 'force-dynamic'`, or use request-time data): `Nav` reads the database, and a statically prerendered page freezes the sidebar (live prompt, chaos badge) at build time. `/simulate` is a static shell, so it needs the export too.
- Links in order: Dashboard `/dashboard` (the logo also links there), Inbox `/` (also active on `/tickets/*`), Approvals `/approvals`, Simulator `/simulate`, Prompts `/prompts`, Ops `/ops`, Lifecycle `/lifecycle`, Safety `/safety`.
- Every page starts with `PageHeader` (title + one-line description), except `/tickets/[id]` which has its own header row.

### 10.3 Charts (`src/components/charts.tsx`, no dependency)
Server-renderable, theme-aware, hover `title` tooltips:
- `Sparkline({ values, className })`: SVG polyline + faint area; "Not enough data" under 2 points.
- `BarChart({ items:[{label,value,className?}], max, threshold?, format?, emptyText?, showLabels? })`: vertical bars scaled to `max`;
  optional dashed red threshold line (drawn only when `threshold <= max`); `showLabels` prints the value above and the label below each bar (for a handful of bars).
- `HBarList({ items:[{label,value}], format? })`: ranked horizontal bars.
- `StackedBar({ segments:[{label,value,className}], format? })`: one stacked bar with a legend showing values and percentages.
- `StackedColumns({ columns:[{label, segments:[{label,value,className}]}] })`: one stacked column per bucket (e.g. per day), hover shows the counts.
- `Ring({ value, label })`: circular progress for a 0..1 value, `n/a` when null.

### 10.4 Pages

**`/` Inbox** — `PageHeader "Inbox"`, then a `Card` "New ticket": `From email` and `Subject` side by side (`sm:grid-cols-2`), `Body` textarea, `Submit`;
on success a result section (badge, reason_code, latency, reply) under a `Separator`; errors in `Alert variant="destructive"`.
Then a `Card` "Recent tickets" (last 50, newest first):
`Time | From | Order | Decision | Reason code | Status | Prompt | Latency (ms) | Cost ($) | Source`. **The whole row is clickable** (`ClickableRow`) and opens `/tickets/[id]`.

**`/tickets/[id]`** (ticket detail; `notFound()` for a malformed id or a missing ticket). In order:
1. Back link `← Back to inbox`; header row: `Ticket detail`, `DecisionBadge`, status badge with a friendly label
   (`Closed automatically`, `Waiting for a human`, `Approved by a human`, `Denied by a human`), `dry run` badge if applicable, ticket id on the right.
2. If `pending_approval`: an `Alert` "Human review required" containing `ApprovalButtons` (text must not state the ticket's `refund_amount_cents`, which is 0 for guardrail escalations; state the looked-up order amount instead).
3. Four stat cards: Latency (hint: number of LLM attempts), Cost (hint: in/out tokens), Prompt version (hint: source), Created (date + time).
4. **Why this decision**: `reason_code` chip, `stage · rule` badge (from `explainDecision`, §17.3), refund amount, the plain-English sentence, and the line
   "The LLM only extracts facts. This decision came from deterministic code…".
5. **Pipeline timeline**: a waterfall, one row per span (`name`, bar positioned by start offset from the first span and sized by duration, red when `status = error`, duration in ms).
   Multiple `llm.extract` spans are numbered `#1`, `#2`; when retried, add the reliability note (and the LLM_UNAVAILABLE note when `llm_error`).
6. Two columns: **Redacted email** (from, subject, body, badge "N PII item(s) redacted…", `injection detected` badge) and **What the LLM extracted** (or "LLM failed").
7. Two columns: **Order looked up** (order id, customer + tier badge, order email in red with "(does not match the sender)" when it differs from `from_email`, product + category, amount,
   days since delivery relative to `STORE_DATE`, prior refunds, order status; or an explanation when there is no order) and **Reply and authorization** (the reply, the least-privilege sentence, and one line per `refunds` row: amount and actor).
8. **Label (synthetic traffic)** with ✓/✗ — only when labeled. 9. **Trace** table: `Span | Attempt | Status | Duration (ms) | In tok | Out tok | Cost | Error`.

**`/approvals`** — `PageHeader`, `Card` "Pending review": tickets with `status = 'pending_approval'`, oldest first:
`Time | From | Order | Reason code | Amount | Email preview (120 chars)` plus `ApprovalButtons` (Approve refund / Deny); rows open the ticket (`ClickableRow`).
Empty state (an `Alert`): "No tickets waiting for review."

**`/ops`** — `PageHeader "Operations"`, then in this order:
1. **SLO cards** (last 50 tickets): Live accuracy, p95 latency, LLM error rate, Escalation rate, Injection rate, Avg cost/ticket, PII leaks. Each card shows value,
   target, `n/a` below the minimum sample, `border-2 border-red-600` when breached (use `RULES` from `monitor.ts`), and a `Sparkline` of the underlying series
   oldest→newest (rates are cumulative; latency and cost are per ticket; PII leaks is a running count; accuracy counts labeled tickets only).
2. **Trends** (2×2 grid of `Card`s, last 50 tickets): Decision mix (`StackedBar`, approve green / deny red / escalate amber), Top reason codes (`HBarList`, top 6),
   Latency per ticket (`BarChart`, bars over the p95 limit red, dashed 8 s line when in range), Eval scores by prompt version (`BarChart`, `max=1`, `threshold=0.9`, `showLabels`,
   latest golden = primary color, adversarial = violet, labels like `v1 golden` / `v1 adv.`).
3. **Alerts** — open and acknowledged: `Time | Rule | Severity | Message | Observed | Threshold | Status` plus `AlertActions`; `RunChecksButton` above the table.
   Observed/threshold use `formatMetric(rule, value)` (percent for rates, `ms`, `$`, integer for PII).
4. **Prompt versions** — `ID | Status | Created | Golden | Adversarial | Regressions | Notes` plus `PromptVersionActions`: Promote (draft/standby), Rollback (only on the live row, only if a standby exists), Retire (draft/standby; reason via `window.prompt`).
5. **Live metrics by prompt version** (last 200 tickets): `Prompt | Tickets | Accuracy (labeled) | p95 ms | Avg cost | Escalation rate`.
6. **Recent eval runs** (last 10): `Time | Prompt | Dataset | Score | Passed/Total | Regressions | Model`.

**`/dashboard`** — executive summary of every other page (server component, `force-dynamic`, latest 1000 tickets; `PageHeader "Executive dashboard"`). Business-first, technical underneath, each card links to its detail page. In order:
1. Six KPI cards with `Sparkline`s: Tickets handled, Automation rate (decision ≠ escalate), Refunds approved by AI ($), Awaiting human review (count + order value), Estimated savings, AI cost per ticket (4 decimals, with avg reply seconds).
2. `StackedColumns` "Ticket volume by outcome" (last 14 days, approved green / denied red / escalated amber, with legend) beside a `Ring` "Automation rate".
3. "Cost to serve: AI vs manual" (`HBarList`) and "Refund value by outcome" (`StackedBar`, order value by decision).
   **Manual cost is an illustrative assumption**: named constants at the top of the file (`MANUAL_COST_PER_TICKET_USD = 4.5`, `MANUAL_HANDLE_MINUTES = 6`), and the page must say so on screen.
4. "Service level objectives" (all 7, green/red/grey dot, same rules and `formatMetric` as `/ops`, last 50 tickets) beside average latency per day (`Sparkline`).
5. Four risk KPI cards (PII redacted, PII leaks stored with red border when > 0, Attacks stopped = injections + identity spoofs, Refund value held), "Why tickets go to a human" (`HBarList`), and "Release status and active alerts" (version badges with latest golden/adversarial score, up to 3 active alerts).

**`/prompts`** — where prompts are viewed (`PageProps<'/prompts'>`, `searchParams` `v` and `compare`; default `v` = the live version). Two columns: a list of every version (id, status badge, latest golden/adversarial score, notes; the selected one highlighted; links `?v=<id>`), and for the selected version:
a `Card` with created, size (words, ≈tokens = chars/4), golden/adversarial score, regressions, live ticket count, live labeled accuracy, promoted, retired (with reason), notes, `PromptVersionActions`, and the gate reminder;
and a `Card` with the full prompt text (`<pre>`, scrollable) or, when `compare=<other id>` is set, a line diff from the compared version to the selected one (`diffLines`: added green `+`, removed red `−`, counts in the title; long lines wrap), with "Compare with" chips and a `clear` link. Include the sentence that the prompt is untrusted-input-aware and that code, not the prompt, decides refunds.

**`/simulate`** — live simulator (`PageHeader "Live simulator"`, `SimulatorPanel`). A "Send mixed traffic" `Card` with `Send 5 / 10 / 25 cases` (sequential calls to `POST /api/simulate` using `pickMixed`: 35% everyday, 35% policy, 20% attack, 10% hard; a `Stop` button and progress text while running);
one `Card` per group (`everyday`, `policy`, `attack`, `hard`) listing each sample with title, `expect <decision>` badge, a one-line "what it shows" and a `Send` button; and a "Results this session" `Card` (newest first, max 100 rows: `# | Case (links to the ticket) | Expected | Actual | Reason code | Match ✓/✗ | Latency`)
with a summary line (sent, matched %, average latency, links to `/dashboard` and `/ops`) and the note that labels assume the seed orders. All buttons disable while a run is in progress; errors in `Alert`.
`samples.ts` holds ≥ 20 samples across the four groups (mirroring golden and adversarial cases, including one known weak spot for the baseline prompt), each with `expected` decision and reason code.
The Dashboard header has a `Simulate live cases` link to this page.

**`/lifecycle`, `/safety`** — see §17.4.

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
"demo": "node --env-file=.env.local --import tsx scripts/demo.ts",
"prompt:add": "node --env-file=.env.local --import tsx scripts/add-prompt.ts"
```

| Script | Behavior |
|---|---|
| `seed [--reset]` | Upsert all orders from `spec/seed/orders.json` (restoring status and prior_refunds); ensure `chaos_config` row exists; if prompt `v1` is missing, insert it from `prompts/v1.md` as `live`. `--reset` also deletes all `spans`, `refunds`, `tickets`, and `alerts` and sets chaos to `none`. Prints counts. |
| `eval` | §11.3 |
| `traffic --scenario normal\|drift [--count N] [--base-url URL]` | `normal` cycles golden then adversarial cases in file order; `drift` cycles drift cases. Default count 50. Sequentially `POST /api/tickets` with `x-traffic-secret`, `dry_run: true`, and the expected labels. Prints a progress line per ticket, then calls `POST /api/ops/check` and prints any new alerts. |
| `chaos <mode>` | Updates `chaos_config.mode`. |
| `demo [--tickets N] [--days N] [--seed N]` | §17.1. Wipes runtime data and loads simulated demo data. |
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

### M7 — Demo and teaching layer (after M5; M6 is a classroom event and may happen before or after)
Implement §17 and the UI in §10: dark/light theme, sidebar, charts, `/dashboard`, ticket detail, `/lifecycle`, `/safety`, the prompt viewer `/prompts` (+ `src/lib/diff.ts`, `tests/diff.test.ts`), the live simulator `/simulate` (+ `src/lib/samples.ts`, `POST /api/simulate`), `scripts/demo.ts`, `src/lib/explain.ts` (+ `tests/explain.test.ts`), the CI workflow, and `GUIDE.md`.
**Accept:** on a fresh clone, `npm run seed && npm run demo && npm run dev` gives a populated app; clicking any inbox row opens the detail view; the theme toggle persists across reload;
`/dashboard`, `/lifecycle` and `/safety` render live numbers; `/prompts` shows every prompt version and a diff between two of them; clicking `Send 5 cases` on `/simulate` adds 5 labeled dry-run tickets and the SLO cards on `/ops` change; the CI workflow (§17.6) is present; `npm test`, `npm run lint`, `npm run build` pass; and screenshots of `/dashboard`, `/`, `/tickets/[id]`, `/prompts` (with a diff), `/simulate` (after a batch), `/ops`, `/lifecycle`, `/safety` were checked in **both themes**.

### Module assignment mapping
TDD on a deterministic component → M1–M2 · golden-set evaluation → M4 · production monitoring and alert
thresholds → M5 · maintenance and rollback playbook → M6 runbook and postmortem.

---

## 16. Non-Goals (do not build)

Authentication or user accounts · sending real emails · real payments · canary percentage routing or shadow
traffic (future lab) · LLM-as-judge (future lab) · chart or theme **libraries** (hand-built charts in §10.3 are required) · streaming · providers other than Anthropic and
heuristic · editing orders in the UI · mobile layouts beyond basic responsiveness.

---

---

## 17. Demo and Teaching Layer (M7)

Goal: a professor or TA can open the app, see a rich two-week history in under a minute, click into any ticket to see *why* it was decided,
and map every course concept (lifecycle, TDD, EDD, monitoring/AIOps, release and maintenance, reliability, security and governance) to something visible.

### 17.1 `scripts/demo.ts` — `npm run demo [-- --tickets 400 --days 14 --seed 7]`
Simulated data; **no LLM call, no money moves, deterministic for a given `--seed`** (use a small seeded PRNG, e.g. mulberry32). Imports from `../src/lib/*` (relative). Steps:
1. **Reset** `spans`, `refunds`, `tickets`, `alerts`; upsert orders from `spec/seed/orders.json`; set chaos `none`. Require an existing `live` prompt (else "Run npm run seed first"). **Never modify `prompt_versions` or `eval_runs`** (they hold the student's real work); all demo tickets use the live version.
2. **Cases:** cycle `spec/evals/golden.jsonl` + `adversarial.jsonl` (**never read `drift.jsonl`**, it is held back until M6). Pick routine (non-escalate) cases 72% of the time, escalation cases 28%.
   Base extraction is built from each case's `expected` fields (defaults: intent `refund_request`, order_id `null`, reason `changed_mind`, injection `false`).
3. **Real decisions:** every ticket's result comes from `decideTicket` (with the seed orders and `STORE_DATE`), the reply from `buildReply`, the body from `redactPII`. Do not hard-code decisions.
4. **Timeline** over `--days` ending now, tickets at random times (sorted), with phases: `healthy` (5% model mistakes), `slow` (1 h at ~45% of the window: attempt 1 times out after 10 000 ms, attempt 2 takes 6.5–9.5 s),
   `outage` (next 2 h: two HTTP 503 attempts, extraction `null` → `LLM_UNAVAILABLE`), `drift` (last 2.5 days: 30% mistakes, wider latency). Force ≥ 24 tickets into the slow+outage window.
   Model mistakes mutate the extraction (off-by-one order id, missed injection, flipped reason, wrong intent) *before* `decideTicket` so accuracy falls naturally.
   Healthy traffic also has ~3% one-retry tickets (HTTP 529 then success).
5. **Spans** per ticket on one timeline: `redact`, one `llm.extract` per attempt (with a 500 ms backoff gap, tokens and cost from `MODEL_PRICING`), `db.lookup_order` only when an order id exists, `policy.decide`. Never emit `refund.issue` (no refund rows are created).
6. **Ticket kinds:** ~55% of escalations become `source='ui'`, `dry_run=false` "customer" tickets: the 8 newest stay `pending_approval`, older ones become `approved_by_human`/`denied_by_human` (60/40).
   Everything else is `source='traffic'`, `dry_run=true`, `status='closed'`, **with** `expected_decision`/`expected_reason_code` labels; `ui` tickets are unlabeled.
7. **Alerts by replay:** every 10 tickets, run `evaluateRules(computeMetrics(last 50))`; open an alert when a rule fires (using the ticket's time), resolve it 45 minutes after it stops firing;
   rules still firing at the end stay `open` (warnings alternate `acknowledged`). Never invent alert numbers.
8. Batch inserts (≤ 500 rows). Print counts (tickets by decision and status, spans, alerts, active alerts) and a hint to run `npm run eval -- --prompt <live>` if `eval_runs` is empty.
`seed --reset` remains the way to return to a clean state.

### 17.2 Ticket detail requirements
See §10.4. Data comes from `tickets`, `spans`, the looked-up `orders` row (`order_id_extracted`) and `refunds` for the ticket. Nothing on the page may be computed by an LLM.

### 17.3 `src/lib/explain.ts` (pure) + `tests/explain.test.ts`
```ts
export interface Explanation { stage: 'Guardrail' | 'Policy' | 'Pipeline'; rule: string; summary: string }
export const EXPLANATIONS: Record<ReasonCode, Explanation>;   // a missing ReasonCode is a type error
export function explainDecision(code: string): Explanation | null;
```
Stage/rule mapping: G1 `LLM_UNAVAILABLE`, G2 `INJECTION_SUSPECTED`, G3 `NOT_A_REFUND`, G4 `MISSING_ORDER_ID`, G5 `IDENTITY_MISMATCH` (Guardrail);
Rule 1 `ORDER_NOT_FOUND`, 2 `ALREADY_REFUNDED`, 3 `NOT_DELIVERED`, 4 `GIFT_CARD_NONREFUNDABLE`, 5 `REFUND_ABUSE_REVIEW`, 6 `DEFECTIVE_ITEM`, `Rule 6 / 9` `HIGH_VALUE_REVIEW`, 7 `FINAL_SALE`, 8 `OUTSIDE_WINDOW`, 10 `WITHIN_POLICY` (Policy);
`REFUND_BLOCKED` → Pipeline / "Authorization". Summaries are one plain-English sentence for a non-engineer. Tests: stages for one code per stage, `null` for an unknown code, every entry has a rule and a sentence.
`monitor.ts` also exports the pure `formatMetric(rule, value)` (percent for rates, `NNN ms`, `$0.0000`, integer for `PII_LEAK`).

### 17.4 `/lifecycle` and `/safety` (server pages, live data, `force-dynamic`)
**`/lifecycle`** — `PageHeader "Lifecycle"`. Eight `Card` stages in a 2-column grid, each with number, title, one-sentence concept, "In this app:" sentence, and an evidence box:
1 Specify (static counts: 10 policy rules · 5 guardrails · 7 SLO metrics · 7 alert rules), 2 Build (the four `ModelProvider`s), 3 Test (TDD) (suite names),
4 Evaluate (EDD) (latest golden/adversarial score and regressions per prompt version, or "Run: npm run eval -- --prompt v1"), 5 Release (a status badge per prompt version),
6 Observe (last-50 accuracy, p95, count of active alerts in red when > 0), 7 Maintain (resolved alerts, rollbacks = versions whose `notes` contain "rolled back", human-decided tickets), 8 Retire (retired versions and reasons).
Then a `Card` "Test-driven vs eval-driven development" (two columns: deterministic code → TDD; probabilistic model → EDD), then a `Table` "Where each course concept shows up"
that covers **all seven course bullets** (lifecycle; TDD; EDD; monitoring/AIOps; release and maintenance; reliability and incident response; operational security and governance) plus human-in-the-loop, each linking to the page where it is visible.

**`/safety`** — `PageHeader "Reliability & Safety"` (description states how many tickets it is based on: the latest 1000). Two sections:
- *Reliability and incident response*: a sentence stating timeout/attempts/backoff from `config.ts`; four stat cards (Saved by retry = `llm.extract` spans with `attempt=2` and `status=ok`; Fell back to human = tickets with `llm_error`;
  Timeouts = spans whose error contains "timed out"; Provider 5xx = spans whose error contains "HTTP 5"); a "Fault injection" card with the current chaos mode badge and the `npm run chaos` commands;
  an "Alert history and incident timeline" table (last 15 alerts, all statuses): `Fired | Rule | Severity | Observed | Status | Time to resolve` (`still active` when unresolved).
- *Operational security and governance*: four stat cards (PII redacted = sum of `redaction_count`, hint with ticket count; PII leaks stored = tickets whose stored body still matches `containsPII` — red border when > 0; Injections escalated; Identity spoofs stopped);
  "Why tickets were escalated" (`HBarList` of escalation reason codes); "Least privilege and tool authorization" (table Agent: delivered, exact amount, ≤ $200 / Human: no cap, with live counts; plus the sentence that authorization is code, not prompt text, and the database is server-only with RLS);
  "Red-team findings and residual risk" (`BarChart` of `eval_results.failure_category` counts across all runs, and a plain statement of the accepted risk and its owner).
`redact.ts` exports `containsPII(text)` (same card/SSN patterns as `redactPII`, no shared regex state) for this purpose and for `metrics.ts`.

### 17.5 `GUIDE.md` (repo root)
Sections, in order: 1 What is this (plain language + flow diagram); 2 Run it (prereqs, every terminal command, `.env.local` table, no-key `heuristic` option, tests/lint/build);
3 Fill it with demo data (`npm run demo` options, what it generates, that it is simulated, `npm run eval` for eval history, `npm run seed -- --reset`); 4 Demo script (~10 min table: step, page, what to say/do; must include Dashboard, Simulator (send a batch, then watch Dashboard/Ops move), Prompts (view, compare, gated promote), Inbox, ticket detail, Approvals, Ops, Safety, Lifecycle; optional live incident with `chaos` + `traffic`);
5 Command cheat sheet + troubleshooting table; 6 Where things are (path table); then **Teaching reference for TAs and instructors**:
A suggested 5-session arc; B concept-by-concept for **each of the seven course concepts** with *what to teach, where to see it, a 10-minute exercise, check-for-understanding questions, common misconceptions*;
C grading/discussion ideas and pitfalls; D facilitator checklist before a live demo. Every command in the guide must be one that exists in `package.json`.

### 17.6 Continuous integration (`.github/workflows/ci.yml`)
Triggers: `push` to `main` and every `pull_request`; `permissions: contents: read`; cancel superseded runs. Node from `.nvmrc`, npm cache. Jobs:
- `checks`: `npm ci` → `npm run lint` → `npm test` → `npm run build` (the build type-checks; give it placeholder `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `LLM_PROVIDER=heuristic`, `CRON_SECRET`, because pages only touch the database at request time, so CI never needs real secrets).
- `hygiene`: fail if `git grep` finds an Anthropic key (`sk-ant-…`) or a JWT-shaped string outside `package-lock.json`, or if `.env.local` is tracked.
- `audit`: `npm audit --omit=dev --audit-level=high`, advisory only (`continue-on-error`).
CI must not call the LLM or the database, and must not run `eval`, `demo`, `seed` or `traffic`.

### 17.7 Lessons that cost time (read before building UI)
- A statically prerendered page freezes anything read from the database in the shared layout (the sidebar's live prompt). Make every page that renders `Nav` dynamic (§10.2).
- The simulator sends real traffic: keep it **dry-run**, restrict it to known sample ids, and label it as simulated. Escalated dry-run tickets close immediately, so use the Inbox form to create a real `pending_approval` ticket.
- Sample expectations assume the seed orders. A human approval (a real refund) changes an order; `npm run seed` restores it. Say so on the page.
- Browser-check hydration-dependent buttons after a full page load (a click right after navigation can land before the client has hydrated).
- `routes.d.ts` types (`PageProps`, `RouteContext`) are generated by `next build`/`next dev`; a bare `tsc --noEmit` on a fresh clone may report them missing, so type-check via `npm run build`.

### 17.8 Definition of done for UI work (applies to every UI change)
Run `npm run build`, start the app with demo data, and look at each changed page in a browser in **both** themes (screenshot). Check: no unstyled or overflowing content at ~1000 px wide, charts have labels or tooltips,
the theme survives a reload, and no text claims something the data does not show (e.g. an amount of $0.00 for an escalation).

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
