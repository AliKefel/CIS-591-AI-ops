import type { Decision } from '@/lib/types';

const STYLES: Record<Decision, string> = {
  approve: 'bg-green-600',
  deny: 'bg-red-600',
  escalate: 'bg-amber-500',
};

export default function DecisionBadge({ decision }: { decision: Decision }) {
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs font-semibold text-white ${STYLES[decision]}`}>
      {decision}
    </span>
  );
}
