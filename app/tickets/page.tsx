import Link from 'next/link';
import { ticketStore } from '@/lib/store';
import { teamStore } from '@/lib/teamStore';
export const dynamic = 'force-dynamic';
import { TicketListClient } from '@/components/TicketListClient';

export default async function TicketsPage({
  searchParams
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const [tickets, teamMembers] = await Promise.all([
    ticketStore.list(status),
    teamStore.listMembers(),
  ]);

  return (
    <main className="max-w-4xl mx-auto px-4 py-10">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Support Tickets</h1>
        <div className="flex gap-2 text-sm items-center">
          <Link
            href="/chat"
            className="px-3 py-1 rounded-full border border-slate-300 hover:bg-slate-100"
          >
            AI Chat
          </Link>
          <Link
            href="/team"
            className="px-3 py-1 rounded-full border border-slate-300 hover:bg-slate-100"
          >
            Team
          </Link>
          <Link
            href="/agents"
            className="px-3 py-1 rounded-full border border-slate-300 hover:bg-slate-100"
          >
            Agents
          </Link>
          <Link
            href="/simulate"
            className="px-3 py-1 rounded-full border border-slate-300 hover:bg-slate-100"
          >
            Simulate
          </Link>
          <a
            href="/tickets"
            className={`px-3 py-1 rounded-full border ${
              !status
                ? 'bg-slate-900 text-white border-slate-900'
                : 'border-slate-300 hover:bg-slate-100'
            }`}
          >
            All
          </a>
          <a
            href="/tickets?status=open"
            className={`px-3 py-1 rounded-full border ${
              status === 'open'
                ? 'bg-slate-900 text-white border-slate-900'
                : 'border-slate-300 hover:bg-slate-100'
            }`}
          >
            Open
          </a>
          <a
            href="/tickets?status=resolved"
            className={`px-3 py-1 rounded-full border ${
              status === 'resolved'
                ? 'bg-slate-900 text-white border-slate-900'
                : 'border-slate-300 hover:bg-slate-100'
            }`}
          >
            Resolved
          </a>
          <a
            href="/tickets?status=archived"
            className={`px-3 py-1 rounded-full border ${
              status === 'archived'
                ? 'bg-slate-900 text-white border-slate-900'
                : 'border-slate-300 hover:bg-slate-100'
            }`}
          >
            Archived
          </a>
        </div>
      </div>

      <TicketListClient tickets={tickets} isArchived={status === 'archived'} teamMembers={teamMembers} />
      {tickets.length === 0 && (
        <p className="text-center text-slate-400 py-16">
          No {status ?? ''} tickets found.
        </p>
      )}
    </main>
  );
}
