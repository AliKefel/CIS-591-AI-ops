'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

export default function RunChecksButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  async function run() {
    setPending(true);
    setMessage(null);
    try {
      const res = await fetch('/api/ops/check', { method: 'POST' });
      const json = await res.json();
      if (!res.ok) {
        setMessage({ text: `${json.error}: ${json.message}`, error: true });
      } else {
        setMessage({ text: `Checks complete: ${json.new_alerts.length} new alert(s)`, error: false });
        router.refresh();
      }
    } catch {
      setMessage({ text: 'Network error. Please try again.', error: true });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="outline" size="sm" onClick={run} disabled={pending}>
        {pending ? 'Running…' : 'Run checks'}
      </Button>
      {message && (
        <Alert variant={message.error ? 'destructive' : 'default'} className="w-fit">
          <AlertDescription className={message.error ? '' : 'text-foreground'}>{message.text}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
