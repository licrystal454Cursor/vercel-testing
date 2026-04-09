import Link from 'next/link';
import type { SupportTicket } from '@/lib/types';

export function TicketCard({ ticket }: { ticket: SupportTicket }) {
  const date = new Date(ticket.createdAt).toLocaleString();

  return (
    <Link
      href={`/tickets/${ticket.id}`}
      className="block p-4 bg-white rounded-lg border border-slate-200 hover:border-slate-300 hover:shadow-sm transition-all"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <p className="font-medium text-slate-900 truncate">
            {ticket.extractedQuestion}
          </p>
          <p className="text-sm text-slate-500 mt-1 truncate">
            {ticket.input.messageText}
          </p>
          <p className="text-xs text-slate-400 mt-2">{date}</p>
        </div>
        <span
          className={`shrink-0 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
            ticket.status === 'open'
              ? 'bg-yellow-100 text-yellow-800'
              : 'bg-green-100 text-green-800'
          }`}
        >
          {ticket.status}
        </span>
      </div>
    </Link>
  );
}
