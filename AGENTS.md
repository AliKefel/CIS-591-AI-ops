<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->


# AGENTS.md — RefundDesk (CIS 591, Module 5)

Read `spec/SPEC.md` in full before writing any code. It is the single source of truth.
If anything here conflicts with `spec/SPEC.md`, the spec wins.

## Stack (already installed — do not change)
Next.js (App Router, `src/`, TypeScript) · Tailwind CSS · `@supabase/supabase-js` · `zod` · `vitest` · `tsx` · Node 24

## Commands
| Command | Purpose |
|---|---|
| `npm ci` | Install exact locked dependencies |
| `npm run dev` | Local dev server |
| `npm test` | Run all tests (`spec/tests/` and `tests/`) |
| `npm run lint` / `npm run build` | Must pass at the end of every milestone |
| `npm run seed [-- --reset]` | Load seed orders + prompt v1 into Supabase |
| `npm run eval -- --prompt <id> [--dataset golden\|adversarial\|drift\|all]` | Offline evals |
| `npm run traffic -- --scenario normal\|drift [--count N]` | Synthetic labeled traffic |
| `npm run chaos -- none\|latency\|errors` | Fault injection for game day |
| `npm run prompt:add -- <id> <path> [--notes "..."]` | Register a draft prompt version |

## Hard rules
1. Build **one milestone at a time, in order** (SPEC §15). After each milestone, stop and report: files changed, `npm test` / `npm run lint` / `npm run build` results.
2. **Never edit anything in `spec/`.** `spec/tests/` are acceptance tests; make them pass without modifying them.
3. **Create only the files listed in SPEC §4.** Do not add pages, routes, tables, or features not in the spec.
4. **Do not add, remove, or upgrade dependencies.** Do not edit `next.config.*`, `tsconfig.json`, `eslint.config.*`, `postcss.config.*`, or `.npmrc`.
5. In `src/lib/` and `scripts/`, use **relative imports** (not `@/`) so `vitest` and `tsx` resolve them. Pages/components may use `@/`.
6. Business logic uses `STORE_DATE` from `src/lib/config.ts` as "now". Never call `new Date()` for policy decisions.
7. Database access only through `getDb()` in `src/lib/db.ts`, only from server code. Never import `db.ts` in a client component. Never expose `SUPABASE_SERVICE_ROLE_KEY`.
8. Pure modules (`policy`, `redact`, `decide`, `replies`, `extract`, `evaluate`, `metrics`, `monitor` rule evaluation, `refunds` authorization) must not read env vars or import `db.ts` at module load.
9. UI: use only the shadcn/ui components in `src/components/ui/` plus Tailwind utilities. Never run the shadcn CLI or add UI/chart libraries.
10. Next.js 15+: dynamic route `params` are Promises — `await params`. Check the installed version in `node_modules/next/package.json` and follow its conventions.
11. Secrets live only in `.env.local`. Never hard-code keys.

