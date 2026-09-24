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
export function HBarList({ items, emptyText = 'No data yet.' }: { items: { label: string; value: number }[]; emptyText?: string }) {
  if (items.length === 0) return <p className="py-6 text-center text-sm text-muted-foreground">{emptyText}</p>;
  const max = Math.max(...items.map((i) => i.value));
  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li key={item.label} className="space-y-1">
          <div className="flex justify-between text-xs">
            <span className="font-mono">{item.label}</span>
            <span className="tabular-nums text-muted-foreground">{item.value}</span>
          </div>
          <div className="h-1.5 rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary" style={{ width: `${(item.value / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

// One stacked horizontal bar with a legend.
export function StackedBar({ segments, emptyText = 'No data yet.' }: { segments: { label: string; value: number; className: string }[]; emptyText?: string }) {
  const total = segments.reduce((n, s) => n + s.value, 0);
  if (total === 0) return <p className="py-6 text-center text-sm text-muted-foreground">{emptyText}</p>;
  return (
    <div className="space-y-4">
      <div className="flex h-4 overflow-hidden rounded-full bg-muted">
        {segments
          .filter((s) => s.value > 0)
          .map((s) => (
            <div key={s.label} title={`${s.label}: ${s.value}`} className={s.className} style={{ width: `${(s.value / total) * 100}%` }} />
          ))}
      </div>
      <ul className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
        {segments.map((s) => (
          <li key={s.label} className="flex items-center gap-2">
            <span className={`size-2.5 rounded-full ${s.className}`} />
            <span className="capitalize">{s.label}</span>
            <span className="tabular-nums text-muted-foreground">
              {s.value} ({((s.value / total) * 100).toFixed(0)}%)
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
