import { z } from 'zod';
import { LLM_BACKOFF_MS, LLM_MAX_ATTEMPTS, LLM_TIMEOUT_MS } from './config';
import { ModelHttpError, type ModelProvider } from './model';
import type { Extraction } from './types';

export const ExtractionSchema: z.ZodType<Extraction> = z.object({
  intent: z.enum(['refund_request', 'other']),
  order_id: z.string().nullable(),
  reason: z.enum(['damaged', 'wrong_item', 'changed_mind', 'other']).nullable(),
  injection_detected: z.boolean(),
});

export function formatUserMessage(fromEmail: string, subject: string, bodyRedacted: string): string {
  return `FROM: ${fromEmail}\nSUBJECT: ${subject}\nBODY:\n<<<\n${bodyRedacted}\n>>>`;
}

export function parseExtraction(text: string): Extraction {
  let s = text.trim();
  s = s.replace(/^```[a-zA-Z]*\s*/, '').replace(/\s*```$/, '');
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) throw new Error('No JSON object found in model output');
  const parsed = ExtractionSchema.parse(JSON.parse(s.slice(start, end + 1)));
  return parsed.order_id === null ? parsed : { ...parsed, order_id: parsed.order_id.trim().toUpperCase() };
}

export interface AttemptRecord {
  attempt: number;
  started_at: string;
  duration_ms: number;
  status: 'ok' | 'error';
  error?: string;
  input_tokens: number;
  output_tokens: number;
}

class TimeoutError extends Error {
  constructor(ms: number) {
    super(`LLM call timed out after ${ms}ms`);
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function extractTicket(args: {
  model: ModelProvider;
  system: string;
  user: string;
  timeoutMs?: number;
  maxAttempts?: number;
  backoffMs?: number;
}): Promise<{ extraction: Extraction | null; attempts: AttemptRecord[] }> {
  const { model, system, user } = args;
  const timeoutMs = args.timeoutMs ?? LLM_TIMEOUT_MS;
  const maxAttempts = args.maxAttempts ?? LLM_MAX_ATTEMPTS;
  const backoffMs = args.backoffMs ?? LLM_BACKOFF_MS;
  const attempts: AttemptRecord[] = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const startedAt = new Date();
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new TimeoutError(timeoutMs));
      }, timeoutMs);
    });

    let inputTokens = 0;
    let outputTokens = 0;
    let retryable = true;
    let error: string | undefined;
    let extraction: Extraction | null = null;

    try {
      const call = model.complete(system, user, { signal: controller.signal });
      call.catch(() => {}); // avoid an unhandled rejection if the timeout wins the race
      const res = await Promise.race([call, timeout]);
      inputTokens = res.input_tokens;
      outputTokens = res.output_tokens;
      extraction = parseExtraction(res.text);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      if (err instanceof ModelHttpError) {
        retryable = err.status === 429 || err.status >= 500;
      }
    } finally {
      clearTimeout(timer);
    }

    attempts.push({
      attempt,
      started_at: startedAt.toISOString(),
      duration_ms: Date.now() - startedAt.getTime(),
      status: extraction ? 'ok' : 'error',
      ...(error ? { error } : {}),
      input_tokens: inputTokens,
      output_tokens: outputTokens,
    });

    if (extraction) return { extraction, attempts };
    if (!retryable) break;
    if (attempt < maxAttempts) await sleep(backoffMs);
  }
  return { extraction: null, attempts };
}
