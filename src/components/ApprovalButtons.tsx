'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function ApprovalButtons({ ticketId }: { ticketId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function act(action: 'approve' | 'deny') {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/approvals/${ticketId}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const json = await res.json();
        setError(`${json.error}: ${json.message}`);
      } else {
        router.refresh();
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-1">
      <div className="flex gap-2">
        <button
          onClick={() => act('approve')}
          disabled={pending}
          className="rounded bg-green-600 px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
        >
          Approve refund
        </button>
        <button
          onClick={() => act('deny')}
          disabled={pending}
          className="rounded bg-red-600 px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
        >
          Deny
        </button>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
