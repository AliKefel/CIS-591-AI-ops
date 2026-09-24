export interface ModelResponse {
  text: string;
  input_tokens: number;
  output_tokens: number;
}

export interface ModelProvider {
  name: string; // model id, 'heuristic', or 'mock'
  complete(system: string, user: string, opts: { signal: AbortSignal }): Promise<ModelResponse>;
}

export class ModelHttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function abortError(): Error {
  const err = new Error('The operation was aborted');
  err.name = 'AbortError';
  return err;
}

// Resolves after `ms`, or rejects with an abort error as soon as `signal` aborts.
function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(abortError());
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export class AnthropicModel implements ModelProvider {
  constructor(private apiKey: string, private model: string) {}

  get name(): string {
    return this.model;
  }

  async complete(system: string, user: string, opts: { signal: AbortSignal }): Promise<ModelResponse> {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 300,
        temperature: 0,
        system,
        messages: [{ role: 'user', content: user }],
      }),
      signal: opts.signal,
    });
    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 300);
      throw new ModelHttpError(res.status, `Anthropic API returned HTTP ${res.status}${detail ? `: ${detail}` : ''}`);
    }
    const data = (await res.json()) as {
      content?: { type: string; text?: string }[];
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const text = (data.content ?? [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text ?? '')
      .join('');
    return {
      text,
      input_tokens: data.usage?.input_tokens ?? 0,
      output_tokens: data.usage?.output_tokens ?? 0,
    };
  }
}

export class HeuristicModel implements ModelProvider {
  name = 'heuristic';

  async complete(_system: string, user: string): Promise<ModelResponse> {
    const orderMatch = user.match(/ORD-\d{4}/i);
    const injection =
      /(ignore (all )?(previous|prior) instructions|system note|admin override|new policy from hq|assistant output)/i.test(user);
    const isRefund = /(refund|return|money back|reembols|devolver)/i.test(user);
    let reason: string | null = null;
    if (isRefund) {
      if (/(wrong item|sent the wrong)/i.test(user)) reason = 'wrong_item';
      else if (/(damag|broke|crack|dent|leak|hole|snap)/i.test(user)) reason = 'damaged';
      else reason = 'changed_mind';
    }
    const text = JSON.stringify({
      intent: isRefund ? 'refund_request' : 'other',
      order_id: orderMatch ? orderMatch[0].toUpperCase() : null,
      reason,
      injection_detected: injection,
    });
    return { text, input_tokens: 0, output_tokens: 0 };
  }
}

export type MockStep =
  | { text: string; input_tokens?: number; output_tokens?: number; delayMs?: number }
  | { httpStatus: number };

// For tests only: each call consumes the next scripted step.
export class MockModel implements ModelProvider {
  name = 'mock';
  calls = 0;
  private index = 0;

  constructor(private script: MockStep[]) {}

  async complete(_system: string, _user: string, opts: { signal: AbortSignal }): Promise<ModelResponse> {
    this.calls++;
    const step = this.script[this.index++];
    if (!step) throw new Error('MockModel script exhausted');
    if ('httpStatus' in step) throw new ModelHttpError(step.httpStatus, `Mock HTTP ${step.httpStatus}`);
    if (step.delayMs) await wait(step.delayMs, opts.signal);
    return { text: step.text, input_tokens: step.input_tokens ?? 0, output_tokens: step.output_tokens ?? 0 };
  }
}

export type ChaosMode = 'none' | 'latency' | 'errors';

export class ChaosModel implements ModelProvider {
  constructor(private inner: ModelProvider, private mode: ChaosMode) {}

  get name(): string {
    return this.inner.name;
  }

  async complete(system: string, user: string, opts: { signal: AbortSignal }): Promise<ModelResponse> {
    if (this.mode === 'errors') throw new ModelHttpError(503, 'Chaos: injected 503');
    if (this.mode === 'latency') await wait(9000, opts.signal);
    return this.inner.complete(system, user, opts);
  }
}

export function getModelFromEnv(): ModelProvider {
  if (process.env.LLM_PROVIDER === 'heuristic') return new HeuristicModel();
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set (or set LLM_PROVIDER=heuristic)');
  return new AnthropicModel(apiKey, process.env.LLM_MODEL || 'claude-haiku-4-5-20251001');
}
