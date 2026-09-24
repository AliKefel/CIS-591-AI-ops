'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import DecisionBadge from './DecisionBadge';
import type { Decision } from '@/lib/types';

interface Result {
  ticket_id: string;
  decision: Decision;
  reason_code: string;
  reply: string;
  latency_ms: number;
}

const input = 'w-full rounded border border-gray-300 px-3 py-2 text-sm';

export default function TicketForm() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    setPending(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/tickets', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          from_email: data.get('from_email'),
          subject: data.get('subject'),
          body: data.get('body'),
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(`${json.error}: ${json.message}`);
      } else {
        setResult(json);
        form.reset();
        router.refresh();
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="rounded border border-gray-200 bg-white p-4">
      <h2 className="mb-3 text-lg font-semibold">New ticket</h2>
      <form onSubmit={onSubmit} className="space-y-3">
        <label className="block text-sm">
          <span className="mb-1 block text-gray-600">From email</span>
          <input name="from_email" type="email" required className={input} />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-gray-600">Subject</span>
          <input name="subject" required maxLength={200} className={input} />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-gray-600">Body</span>
          <textarea name="body" required maxLength={5000} rows={5} className={input} />
        </label>
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {pending ? 'Submitting…' : 'Submit'}
        </button>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </form>

      {result && (
        <div className="mt-4 space-y-2 rounded border border-gray-200 bg-gray-50 p-3 text-sm">
          <div className="flex items-center gap-3">
            <DecisionBadge decision={result.decision} />
            <code className="text-gray-700">{result.reason_code}</code>
            <span className="text-gray-500">{result.latency_ms} ms</span>
          </div>
          <p className="text-gray-800">{result.reply}</p>
        </div>
      )}
    </section>
  );
}
