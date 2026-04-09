import { notFound } from 'next/navigation';
import { ticketStore } from '@/lib/store';
import { TicketDetailClient } from './TicketDetailClient';

export default async function TicketDetailPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ticket = ticketStore.get(id);
  if (!ticket) notFound();

  return (
    <main className="max-w-3xl mx-auto px-4 py-10">
      <a
        href="/tickets"
        className="inline-block text-sm text-slate-500 hover:text-slate-900 mb-6"
      >
        ← Back to tickets
      </a>
      <TicketDetailClient ticket={ticket} />
    </main>
  );
}
