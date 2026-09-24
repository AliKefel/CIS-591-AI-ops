'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import DecisionBadge from './DecisionBadge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import type { Decision } from '@/lib/types';

interface Result {
  ticket_id: string;
  decision: Decision;
  reason_code: string;
  reply: string;
  latency_ms: number;
}

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
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">New ticket</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="from_email">From email</Label>
              <Input id="from_email" name="from_email" type="email" required placeholder="customer@example.com" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="subject">Subject</Label>
              <Input id="subject" name="subject" required maxLength={200} placeholder="Return request" />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="body">Body</Label>
            <Textarea id="body" name="body" required maxLength={5000} rows={5} placeholder="Paste the customer email…" />
          </div>
          <Button type="submit" disabled={pending}>
            {pending ? 'Submitting…' : 'Submit'}
          </Button>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </form>

        {result && (
          <>
            <Separator className="my-5" />
            <div className="space-y-3 text-sm">
              <div className="flex flex-wrap items-center gap-3">
                <DecisionBadge decision={result.decision} />
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{result.reason_code}</code>
                <span className="text-muted-foreground">{result.latency_ms} ms</span>
              </div>
              <p className="text-foreground/90">{result.reply}</p>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
