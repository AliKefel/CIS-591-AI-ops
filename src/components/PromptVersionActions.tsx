'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

type Status = 'draft' | 'live' | 'standby' | 'retired';

export default function PromptVersionActions({
  id,
  status,
  hasStandby,
}: {
  id: string;
  status: Status;
  hasStandby: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function call(url: string, body?: unknown) {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (!res.ok) {
        const json = await res.json();
        const gate = json.error === 'GATE_FAILED' ? ' (see the Golden / Adversarial / Regressions columns)' : '';
        setError(`${json.error}: ${json.message}${gate}`);
      } else {
        router.refresh();
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setPending(false);
    }
  }

  function retire() {
    const reason = window.prompt(`Reason for retiring ${id} (min 5 characters):`);
    if (reason === null) return;
    call(`/api/prompt-versions/${id}/retire`, { reason });
  }

  const canPromote = status === 'draft' || status === 'standby';
  const canRollback = status === 'live' && hasStandby;
  const canRetire = status === 'draft' || status === 'standby';
  if (!canPromote && !canRollback && !canRetire) return null;

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        {canPromote && (
          <Button size="sm" onClick={() => call(`/api/prompt-versions/${id}/promote`)} disabled={pending}>
            Promote
          </Button>
        )}
        {canRollback && (
          <Button size="sm" variant="destructive" onClick={() => call('/api/prompt-versions/rollback')} disabled={pending}>
            Rollback
          </Button>
        )}
        {canRetire && (
          <Button size="sm" variant="destructive" onClick={retire} disabled={pending}>
            Retire
          </Button>
        )}
      </div>
      {error && (
        <Alert variant="destructive" className="max-w-xs">
          <AlertDescription className="text-xs">{error}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
