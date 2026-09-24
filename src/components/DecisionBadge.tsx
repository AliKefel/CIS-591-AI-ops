import { Badge } from '@/components/ui/badge';
import type { Decision } from '@/lib/types';

const STYLES: Record<Decision, string> = {
  approve: 'bg-green-600',
  deny: 'bg-red-600',
  escalate: 'bg-amber-500',
};

export default function DecisionBadge({ decision }: { decision: Decision }) {
  return <Badge className={`${STYLES[decision]} text-white capitalize`}>{decision}</Badge>;
}
