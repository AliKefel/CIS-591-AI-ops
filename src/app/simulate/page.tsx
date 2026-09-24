import PageHeader from '@/components/PageHeader';
import SimulatorPanel from '@/components/SimulatorPanel';

// Dynamic so the sidebar (live prompt, chaos badge) is rendered per request, not frozen at build time.
export const dynamic = 'force-dynamic';

export default function SimulatePage() {
  return (
    <div>
      <PageHeader title="Live simulator" description="Send realistic customer emails through the running system and watch the results, dashboards and alerts respond." />
      <SimulatorPanel />
    </div>
  );
}
