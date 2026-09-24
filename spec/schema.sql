-- RefundDesk schema (CIS 591, Module 5)
-- Run once in the Supabase SQL editor. Do not edit.

create extension if not exists pgcrypto;

create table if not exists orders (
  id              text primary key check (id ~ '^ORD-[0-9]{4}$'),
  customer_name   text not null,
  customer_email  text not null,
  loyalty_tier    text not null check (loyalty_tier in ('standard', 'gold')),
  product_name    text not null,
  category        text not null check (category in ('apparel', 'gear', 'electronics', 'final_sale', 'gift_card')),
  amount_cents    integer not null check (amount_cents > 0),
  delivered_at    timestamptz,
  status          text not null check (status in ('in_transit', 'delivered', 'refunded')),
  prior_refunds   integer not null default 0 check (prior_refunds >= 0)
);

create table if not exists prompt_versions (
  id              text primary key,
  content         text not null,
  status          text not null default 'draft' check (status in ('draft', 'live', 'standby', 'retired')),
  notes           text,
  created_at      timestamptz not null default now(),
  promoted_at     timestamptz,
  retired_at      timestamptz,
  retired_reason  text
);
create unique index if not exists one_live_prompt    on prompt_versions ((status)) where status = 'live';
create unique index if not exists one_standby_prompt on prompt_versions ((status)) where status = 'standby';

create table if not exists tickets (
  id                    uuid primary key default gen_random_uuid(),
  created_at            timestamptz not null default now(),
  source                text not null check (source in ('ui', 'traffic')),
  dry_run               boolean not null default false,
  from_email            text not null,
  subject               text not null,
  body_redacted         text not null,
  redaction_count       integer not null default 0,
  prompt_version_id     text not null references prompt_versions(id),
  intent                text,
  order_id_extracted    text,
  reason                text,
  injection_detected    boolean,
  llm_error             boolean not null default false,
  decision              text not null check (decision in ('approve', 'deny', 'escalate')),
  reason_code           text not null,
  refund_amount_cents   integer not null default 0,
  reply                 text not null,
  status                text not null check (status in ('closed', 'pending_approval', 'approved_by_human', 'denied_by_human')),
  latency_ms            integer not null,
  input_tokens          integer not null default 0,
  output_tokens         integer not null default 0,
  cost_usd              numeric(10, 6) not null default 0,
  expected_decision     text check (expected_decision in ('approve', 'deny', 'escalate')),
  expected_reason_code  text
);
create index if not exists tickets_created_at_idx on tickets (created_at desc);
create index if not exists tickets_status_idx on tickets (status);

create table if not exists spans (
  id             uuid primary key default gen_random_uuid(),
  ticket_id      uuid not null references tickets(id) on delete cascade,
  name           text not null check (name in ('redact', 'llm.extract', 'db.lookup_order', 'policy.decide', 'refund.issue')),
  attempt        integer not null default 1,
  started_at     timestamptz not null,
  duration_ms    integer not null,
  status         text not null check (status in ('ok', 'error')),
  error_message  text,
  input_tokens   integer not null default 0,
  output_tokens  integer not null default 0,
  cost_usd       numeric(10, 6) not null default 0
);
create index if not exists spans_ticket_idx on spans (ticket_id);

create table if not exists refunds (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  order_id      text not null references orders(id),
  ticket_id     uuid references tickets(id) on delete set null,
  amount_cents  integer not null check (amount_cents > 0),
  approved_by   text not null check (approved_by in ('agent', 'human'))
);

create table if not exists eval_runs (
  id                 uuid primary key default gen_random_uuid(),
  created_at         timestamptz not null default now(),
  prompt_version_id  text not null references prompt_versions(id),
  dataset            text not null check (dataset in ('golden', 'adversarial', 'drift')),
  model              text not null,
  total              integer not null,
  passed             integer not null,
  score              numeric(5, 4) not null,
  regressions        integer not null default 0,
  baseline_run_id    uuid references eval_runs(id)
);
create index if not exists eval_runs_lookup_idx on eval_runs (prompt_version_id, dataset, created_at desc);

create table if not exists eval_results (
  id                uuid primary key default gen_random_uuid(),
  run_id            uuid not null references eval_runs(id) on delete cascade,
  case_id           text not null,
  passed            boolean not null,
  failure_category  text check (failure_category in (
                      'LLM_ERROR', 'LEAKED_PII', 'FOLLOWED_INJECTION', 'FALSE_INJECTION',
                      'WRONG_INTENT', 'WRONG_ORDER_ID', 'WRONG_REASON', 'OTHER')),
  expected          jsonb not null,
  actual            jsonb not null
);

create table if not exists alerts (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  rule         text not null check (rule in (
                 'LIVE_ACCURACY_LOW', 'LLM_ERROR_RATE_HIGH', 'PII_LEAK', 'P95_LATENCY_HIGH',
                 'ESCALATION_RATE_HIGH', 'INJECTION_SPIKE', 'COST_HIGH')),
  severity     text not null check (severity in ('warning', 'critical')),
  message      text not null,
  observed     numeric not null,
  threshold    numeric not null,
  status       text not null default 'open' check (status in ('open', 'acknowledged', 'resolved')),
  resolved_at  timestamptz
);

create table if not exists chaos_config (
  id          integer primary key default 1 check (id = 1),
  mode        text not null default 'none' check (mode in ('none', 'latency', 'errors')),
  updated_at  timestamptz not null default now()
);
insert into chaos_config (id, mode) values (1, 'none') on conflict (id) do nothing;

-- Least privilege: RLS on, no policies. Only the server's service role (which bypasses RLS) can access data.
alter table orders          enable row level security;
alter table prompt_versions enable row level security;
alter table tickets         enable row level security;
alter table spans           enable row level security;
alter table refunds         enable row level security;
alter table eval_runs       enable row level security;
alter table eval_results    enable row level security;
alter table alerts          enable row level security;
alter table chaos_config    enable row level security;
