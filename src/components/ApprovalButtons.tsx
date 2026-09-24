'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

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
    <div className="space-y-2">
      <div className="flex gap-2">
        <Button size="sm" onClick={() => act('approve')} disabled={pending}>
          Approve refund
        </Button>
        <Button size="sm" variant="destructive" onClick={() => act('deny')} disabled={pending}>
          Deny
        </Button>
      </div>
      {error && (
        <Alert variant="destructive" className="max-w-xs">
          <AlertDescription className="text-xs">{error}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
