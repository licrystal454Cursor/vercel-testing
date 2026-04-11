import { agentStore } from '@/lib/agentStore';
import { teamStore } from '@/lib/teamStore';
import { AgentsPageClient } from '@/components/AgentsPageClient';
export const dynamic = 'force-dynamic';

export default async function AgentsPage() {
  const [agents, assignments] = await Promise.all([
    agentStore.list(),
    teamStore.listChannelAssignments(),
  ]);

  return (
    <main className="max-w-4xl mx-auto px-4 py-10">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold">AI Agents</h1>
          <p className="text-sm text-slate-500 mt-1">Define agent behavior with markdown — apply to channels</p>
        </div>
        <a href="/tickets" className="text-sm text-slate-500 hover:text-slate-900">
          ← Back to tickets
        </a>
      </div>
      <AgentsPageClient initialAgents={agents} initialAssignments={assignments} />
    </main>
  );
}
