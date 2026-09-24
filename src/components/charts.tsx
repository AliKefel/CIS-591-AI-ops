// Dependency-free charts (Tailwind + inline SVG). Server-renderable, theme-aware via CSS variables.

export function Sparkline({ values, className = 'text-primary' }: { values: number[]; className?: string }) {
  if (values.length < 2) {
    return <div className="h-8 text-xs text-muted-foreground">Not enough data</div>;
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const points = values.map((v, i) => {
    const x = (i / (values.length - 1)) * 100;
    const y = 28 - ((v - min) / span) * 26;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" className={`h-8 w-full ${className}`} role="img" aria-label="Trend">
      <polygon points={`0,30 ${points.join(' ')} 100,30`} fill="currentColor" opacity="0.12" />
      <polyline points={points.join(' ')} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export interface BarItem {
  label: string;
  value: number;
  className?: string; // Tailwind bg-* class for this bar
}

// Vertical bars scaled to `max`; an optional dashed threshold line; hover title on each bar.
export function BarChart({
  items,
  max,
  threshold,
  format = (v: number) => String(v),
  emptyText = 'No data yet.',
  showLabels = false,
}: {
  items: BarItem[];
  max: number;
  threshold?: number;
  format?: (v: number) => string;
  emptyText?: string;
  showLabels?: boolean; // print each bar's value above it and its label below (for a handful of bars)
}) {
  if (items.length === 0) return <p className="py-6 text-center text-sm text-muted-foreground">{emptyText}</p>;
  const pct = (v: number) => `${Math.max(2, Math.min(100, (v / max) * 100))}%`;
  return (
    <div>
      <div className="relative h-36">
        <div className={`absolute inset-0 flex items-end ${showLabels ? 'gap-3' : 'gap-0.5'}`}>
          {items.map((item, i) => (
            <div key={i} className="flex h-full min-w-0.5 flex-1 flex-col justify-end">
              {showLabels && <span className="mb-1 text-center text-[11px] tabular-nums text-muted-foreground">{format(item.value)}</span>}
              <div
                title={`${item.label}: ${format(item.value)}`}
                className={`rounded-t-sm ${item.className ?? 'bg-primary'} opacity-90 transition-opacity hover:opacity-100`}
                style={{ height: showLabels ? `calc(${pct(item.value)} - 1.25rem)` : pct(item.value) }}
              />
            </div>
          ))}
        </div>
        {threshold !== undefined && threshold <= max && (
          <div className="pointer-events-none absolute inset-x-0 border-t border-dashed border-red-500/70" style={{ bottom: `${(threshold / max) * 100}%` }}>
            <span className="absolute -top-4 right-0 text-[10px] text-red-500">{format(threshold)}</span>
          </div>
        )}
      </div>
      {showLabels && (
        <div className="mt-1 flex gap-3">
          {items.map((item, i) => (
            <span key={i} className="min-w-0.5 flex-1 truncate text-center text-[11px] text-muted-foreground">{item.label}</span>
          ))}
        </div>
      )}
    </div>
  );
}

// Horizontal bars for ranked counts.
export function HBarList({ items, emptyText = 'No data yet.', format = (v: number) => String(v) }: { items: { label: string; value: number }[]; emptyText?: string; format?: (v: number) => string }) {
  if (items.length === 0) return <p className="py-6 text-center text-sm text-muted-foreground">{emptyText}</p>;
  const max = Math.max(...items.map((i) => i.value));
  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li key={item.label} className="space-y-1">
          <div className="flex justify-between text-xs">
            <span className="font-mono">{item.label}</span>
            <span className="tabular-nums text-muted-foreground">{format(item.value)}</span>
          </div>
          <div className="h-1.5 rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(1, (item.value / max) * 100)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

// One stacked horizontal bar with a legend.
export function StackedBar({ segments, emptyText = 'No data yet.', format = (v: number) => String(v) }: { segments: { label: string; value: number; className: string }[]; emptyText?: string; format?: (v: number) => string }) {
  const total = segments.reduce((n, s) => n + s.value, 0);
  if (total === 0) return <p className="py-6 text-center text-sm text-muted-foreground">{emptyText}</p>;
  return (
    <div className="space-y-4">
      <div className="flex h-4 overflow-hidden rounded-full bg-muted">
        {segments
          .filter((s) => s.value > 0)
          .map((s) => (
            <div key={s.label} title={`${s.label}: ${format(s.value)}`} className={s.className} style={{ width: `${(s.value / total) * 100}%` }} />
          ))}
      </div>
      <ul className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
        {segments.map((s) => (
          <li key={s.label} className="flex items-center gap-2">
            <span className={`size-2.5 rounded-full ${s.className}`} />
            <span className="capitalize">{s.label}</span>
            <span className="tabular-nums text-muted-foreground">
              {format(s.value)} ({((s.value / total) * 100).toFixed(0)}%)
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// One stacked column per bucket (e.g. per day). Each segment has a Tailwind bg-* class; hover shows the counts.
export function StackedColumns({
  columns,
  emptyText = 'No data yet.',
}: {
  columns: { label: string; segments: { label: string; value: number; className: string }[] }[];
  emptyText?: string;
}) {
  const totals = columns.map((c) => c.segments.reduce((n, s) => n + s.value, 0));
  const max = Math.max(0, ...totals);
  if (max === 0) return <p className="py-6 text-center text-sm text-muted-foreground">{emptyText}</p>;
  return (
    <div>
      <div className="flex h-44 items-end gap-1.5">
        {columns.map((c, i) => (
          <div
            key={i}
            className="flex h-full min-w-0 flex-1 flex-col justify-end"
            title={`${c.label}: ${c.segments.map((s) => `${s.value} ${s.label}`).join(', ')}`}
          >
            <div className="flex flex-col-reverse overflow-hidden rounded-t-sm" style={{ height: `${(totals[i] / max) * 100}%` }}>
              {c.segments.map((s) => (
                <div key={s.label} className={s.className} style={{ height: totals[i] ? `${(s.value / totals[i]) * 100}%` : 0 }} />
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-1.5">
        {columns.map((c, i) => (
          <span key={i} className="min-w-0 flex-1 truncate text-center text-[10px] text-muted-foreground">
            {i % Math.ceil(columns.length / 7) === 0 ? c.label : ''}
          </span>
        ))}
      </div>
    </div>
  );
}

// Circular progress for a 0..1 value.
export function Ring({ value, label, className = 'text-primary' }: { value: number | null; label: string; className?: string }) {
  const r = 42;
  const c = 2 * Math.PI * r;
  const v = value === null ? 0 : Math.max(0, Math.min(1, value));
  return (
    <div className="flex flex-col items-center gap-2">
      <svg viewBox="0 0 100 100" className="size-32" role="img" aria-label={`${label}: ${value === null ? 'n/a' : `${(v * 100).toFixed(0)}%`}`}>
        <circle cx="50" cy="50" r={r} fill="none" strokeWidth="10" className="stroke-muted" />
        <circle
          cx="50" cy="50" r={r} fill="none" strokeWidth="10" strokeLinecap="round"
          className={`stroke-current ${className}`}
          strokeDasharray={`${v * c} ${c}`}
          transform="rotate(-90 50 50)"
        />
        <text x="50" y="55" textAnchor="middle" className="fill-foreground text-[20px] font-semibold">
          {value === null ? 'n/a' : `${(v * 100).toFixed(0)}%`}
        </text>
      </svg>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}
