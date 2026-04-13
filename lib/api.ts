import type { SupportTicket } from './types';

export async function sendReply(
  id: string,
  reply: string
): Promise<{ ticket: SupportTicket }> {
  const res = await fetch(`/api/tickets/${id}/reply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reply })
  });
  if (!res.ok) throw new Error('Failed to send reply');
  return res.json();
}

export async function bulkArchive(ids: string[], archived: boolean): Promise<void> {
  const res = await fetch('/api/tickets/bulk', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids, archived }),
  });
  if (!res.ok) throw new Error('Failed to bulk archive');
}

export async function patchTicket(
  id: string,
  patch: Partial<SupportTicket>
): Promise<{ ticket: SupportTicket }> {
  const res = await fetch(`/api/tickets/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch)
  });
  if (!res.ok) throw new Error('Failed to update ticket');
  return res.json();
}
