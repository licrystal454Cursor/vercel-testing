import { notFound } from 'next/navigation';
import { ticketStore } from '@/lib/store';
import { teamStore } from '@/lib/teamStore';
import { chatStore } from '@/lib/chatStore';
import { TicketDetailClient } from './TicketDetailClient';
import type { SupportTicket } from '@/lib/types';
import type { ChatMessage } from '@/lib/chatStore';

function buildInitialMessage(ticket: SupportTicket): string {
  const lines: string[] = [
    `Here's what I found on this ticket:`,
    ``,
    `Issue: ${ticket.extractedQuestion || ticket.input.messageText}`,
    ``,
  ];

  if (ticket.aiAnalysis) {
    lines.push(ticket.aiAnalysis, ``);
  }

  if (ticket.aiDraftReply) {
    lines.push(`Suggested reply to customer:`, ``, ticket.aiDraftReply, ``);
  }

  lines.push(
    `How can I help you refine this? I can look up additional documentation, check Stripe account data, or help rewrite the draft.`
  );

  return lines.join('\n');
}

export default async function TicketDetailPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [ticket, members] = await Promise.all([
    ticketStore.get(id),
    teamStore.listMembers(),
  ]);
  if (!ticket) notFound();

  const dbMessages = await chatStore.list(id);

  // Drop any legacy persisted initial assistant message (the old code saved one to DB).
  // We now generate it fresh every render so it always reflects completed enrichment.
  const firstIsAssistant = dbMessages[0]?.role === 'assistant';
  const chatMessages = firstIsAssistant ? dbMessages.slice(1) : dbMessages;

  // Always generate the initial message from the current ticket state — never persisted.
  // This ensures it reflects completed enrichment even if the page was opened before
  // enrichment finished.
  const syntheticInitial: ChatMessage = {
    id: 'initial',
    role: 'assistant',
    content: buildInitialMessage(ticket),
    createdAt: ticket.createdAt,
  };

  return (
    <main className="w-full px-6 py-8">
      <a
        href="/tickets"
        className="inline-block text-sm text-slate-500 hover:text-slate-900 mb-6"
      >
        ← Back to tickets
      </a>
      <TicketDetailClient ticket={ticket} teamMembers={members} initialChatMessages={[syntheticInitial, ...chatMessages]} />
    </main>
  );
}
