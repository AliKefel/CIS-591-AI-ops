'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import DecisionBadge from './DecisionBadge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { GROUP_LABEL, SAMPLES, pickMixed, type SampleGroup } from '@/lib/samples';
import type { Decision } from '@/lib/types';

interface Result {
  n: number;
  sample_id: string;
  title: string;
  ticket_id: string;
  decision: Decision;
  reason_code: string;
  expected_decision: Decision;
  expected_reason_code: string;
  match: boolean;
  latency_ms: number;
}

const GROUPS: SampleGroup[] = ['everyday', 'policy', 'attack', 'hard'];

export default function SimulatorPanel() {
  const [results, setResults] = useState<Result[]>([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stop = useRef(false);
  const counter = useRef(0);

  async function send(sampleId: string): Promise<boolean> {
    const sample = SAMPLES.find((s) => s.id === sampleId);
    try {
      const res = await fetch('/api/simulate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sample_id: sampleId }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(`${json.error}: ${json.message}`);
        return false;
      }
      counter.current += 1;
      setResults((prev) => [{ ...json, n: counter.current, title: sample?.title ?? sampleId }, ...prev].slice(0, 100));
      return true;
    } catch {
      setError('Network error. Please try again.');
      return false;
    }
  }

  async function runOne(id: string) {
    setRunning(true);
    setError(null);
    await send(id);
    setRunning(false);
  }

  async function runBatch(count: number) {
    setRunning(true);
    setError(null);
    stop.current = false;
    for (let i = 0; i < count && !stop.current; i++) {
      setProgress(`Sending ${i + 1} of ${count}…`);
      if (!(await send(pickMixed().id))) break;
    }
    setProgress(null);
    setRunning(false);
  }

  const correct = results.filter((r) => r.match).length;
  const avg = results.length ? Math.round(results.reduce((n, r) => n + r.latency_ms, 0) / results.length) : 0;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Send mixed traffic</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Runs realistic emails through the live pipeline one at a time: the real LLM, guardrails and policy. Tickets are stored as labeled dry-run traffic, so no refunds are issued.
            Watch the Dashboard and Ops pages move.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => runBatch(5)} disabled={running}>Send 5 cases</Button>
            <Button onClick={() => runBatch(10)} disabled={running}>Send 10 cases</Button>
            <Button variant="outline" onClick={() => runBatch(25)} disabled={running}>Send 25 cases</Button>
            {running && progress && (
              <>
                <span className="text-sm text-muted-foreground">{progress}</span>
                <Button variant="destructive" size="sm" onClick={() => { stop.current = true; }}>Stop</Button>
              </>
            )}
          </div>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {GROUPS.map((g) => (
          <Card key={g}>
            <CardHeader>
              <CardTitle>{GROUP_LABEL[g]}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {SAMPLES.filter((s) => s.group === g).map((s) => (
                <div key={s.id} className="flex items-center justify-between gap-3 rounded-lg border p-2.5">
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      {s.title}
                      <Badge variant="outline" className="text-[10px]">expect {s.expected.decision}</Badge>
                    </div>
                    <div className="truncate text-xs text-muted-foreground">{s.shows}</div>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => runOne(s.id)} disabled={running}>Send</Button>
                </div>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Results this session</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {results.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
              <span><span className="font-semibold tabular-nums">{results.length}</span> sent</span>
              <span><span className="font-semibold tabular-nums">{correct}</span> matched the expected label ({((correct / results.length) * 100).toFixed(0)}%)</span>
              <span>avg reply <span className="font-semibold tabular-nums">{avg} ms</span></span>
              <Link href="/dashboard" className="text-primary underline-offset-4 hover:underline">View dashboard →</Link>
              <Link href="/ops" className="text-primary underline-offset-4 hover:underline">View ops →</Link>
            </div>
          )}
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                {['#', 'Case', 'Expected', 'Actual', 'Reason code', 'Match', 'Latency (ms)'].map((h) => (
                  <TableHead key={h} className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{h}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {results.length === 0 && (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">Nothing sent yet. Click a button above.</TableCell>
                </TableRow>
              )}
              {results.map((r) => (
                <TableRow key={r.n}>
                  <TableCell className="tabular-nums text-muted-foreground">{r.n}</TableCell>
                  <TableCell>
                    <Link href={`/tickets/${r.ticket_id}`} className="font-medium underline-offset-4 hover:underline">{r.title}</Link>
                  </TableCell>
                  <TableCell><Badge variant="outline">{r.expected_decision}</Badge></TableCell>
                  <TableCell><DecisionBadge decision={r.decision} /></TableCell>
                  <TableCell className="font-mono text-xs">{r.reason_code}</TableCell>
                  <TableCell className={r.match ? 'font-semibold text-green-600' : 'font-semibold text-red-600'}>{r.match ? '✓' : '✗'}</TableCell>
                  <TableCell className="tabular-nums">{r.latency_ms}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="text-xs text-muted-foreground">
            Labels assume the seed orders. If a human approved a refund, that order is no longer refundable and related cases will show ✗ until you run <code className="rounded bg-muted px-1">npm run seed</code>.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
