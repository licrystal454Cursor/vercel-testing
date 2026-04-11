'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { bulkArchive } from '@/lib/api';
import type { SupportTicket, TeamMember } from '@/lib/types';

function statusStyle(ticket: SupportTicket) {
  if (ticket.status === 'resolved') return 'bg-green-100 text-green-800';
  if (ticket.status === 'waiting_on_customer') return 'bg-blue-100 text-blue-800';
  return 'bg-yellow-100 text-yellow-800';
}

function statusLabel(ticket: SupportTicket) {
  if (ticket.status === 'waiting_on_customer') return 'waiting';
  return ticket.status;
}

export function TicketListClient({
  tickets,
  isArchived,
  teamMembers = [],
}: {
  tickets: SupportTicket[];
  isArchived: boolean;
  teamMembers?: TeamMember[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const allSelected = tickets.length > 0 && selected.size === tickets.length;
  const someSelected = selected.size > 0;

  const toggle = (id: string) =>
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(tickets.map(t => t.id)));

  const handleBulkArchive = async () => {
    setBusy(true);
    try {
      await bulkArchive([...selected], !isArchived);
      toast.success(
        isArchived
          ? `${selected.size} ticket${selected.size > 1 ? 's' : ''} unarchived`
          : `${selected.size} ticket${selected.size > 1 ? 's' : ''} archived`
      );
      setSelected(new Set());
      router.refresh();
    } catch {
      toast.error('Failed to update tickets');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      {/* Bulk action bar */}
      {someSelected && (
        <div className="flex items-center justify-between bg-slate-900 text-white rounded-lg px-4 py-2.5">
          <span className="text-sm font-medium">
            {selected.size} ticket{selected.size > 1 ? 's' : ''} selected
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={handleBulkArchive}
              disabled={busy}
              className="px-3 py-1 bg-white text-slate-900 rounded text-sm font-medium hover:bg-slate-100 disabled:opacity-50 transition-colors"
            >
              {busy ? 'Updating...' : isArchived ? 'Unarchive' : 'Archive'}
            </button>
            <button
              onClick={() => setSelected(new Set())}
              className="px-3 py-1 text-slate-300 hover:text-white text-sm transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Select-all row */}
      {tickets.length > 0 && (
        <div className="flex items-center gap-3 px-4 py-1">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={toggleAll}
            className="w-4 h-4 rounded border-slate-300 accent-slate-900 cursor-pointer"
          />
          <span className="text-xs text-slate-400">Select all</span>
        </div>
      )}

      {/* Ticket rows */}
      {tickets.map(ticket => (
        <div
          key={ticket.id}
          className={`flex items-center gap-3 bg-white rounded-lg border transition-all ${
            selected.has(ticket.id)
              ? 'border-slate-400 shadow-sm'
              : 'border-slate-200 hover:border-slate-300'
          }`}
        >
          <div className="pl-4 flex-shrink-0">
            <input
              type="checkbox"
              checked={selected.has(ticket.id)}
              onChange={() => toggle(ticket.id)}
              className="w-4 h-4 rounded border-slate-300 accent-slate-900 cursor-pointer"
            />
          </div>
          <Link
            href={`/tickets/${ticket.id}`}
            className="flex-1 min-w-0 p-4 pl-1"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <p className="font-medium text-slate-900 truncate">
                  {ticket.extractedQuestion}
                </p>
                <p className="text-sm text-slate-500 mt-1 truncate">
                  {ticket.input.messageText}
                </p>
                <p className="text-xs text-slate-400 mt-2">
                  {new Date(ticket.createdAt).toLocaleString()}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {ticket.assigneeId && (
                  <span className="text-xs text-slate-500">
                    {teamMembers.find(m => m.id === ticket.assigneeId)?.name ?? ''}
                  </span>
                )}
                <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${statusStyle(ticket)}`}>
                  {statusLabel(ticket)}
                </span>
              </div>
            </div>
          </Link>
        </div>
      ))}
    </div>
  );
}
