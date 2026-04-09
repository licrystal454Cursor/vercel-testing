import type { SupportTicket } from './types';

const API = process.env.LEAD_AGENT_API_URL ?? 'http://localhost:3000';

export async function createTicket(
  messageText: string
): Promise<{ ticket: SupportTicket }> {
  const res = await fetch(`${API}/api/tickets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messageText }),
  });
  if (!res.ok) throw new Error('Failed to create ticket');
  return res.json();
}

export async function fetchTickets(
  status?: string
): Promise<{ tickets: SupportTicket[] }> {
  const url = status
    ? `${API}/api/tickets?status=${status}`
    : `${API}/api/tickets`;
  const res = await fetch(url, { next: { revalidate: 30 } });
  if (!res.ok) throw new Error('Failed to fetch tickets');
  return res.json();
}

export async function fetchTicket(
  id: string
): Promise<{ ticket: SupportTicket }> {
  const res = await fetch(`${API}/api/tickets/${id}`, { cache: 'no-store' });
  if (!res.ok) throw new Error('Failed to fetch ticket');
  return res.json();
}

export async function sendReply(
  id: string,
  reply: string
): Promise<{ ticket: SupportTicket }> {
  const res = await fetch(`${API}/api/tickets/${id}/reply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reply })
  });
  if (!res.ok) throw new Error('Failed to send reply');
  return res.json();
}

export async function patchTicket(
  id: string,
  patch: Partial<SupportTicket>
): Promise<{ ticket: SupportTicket }> {
  const res = await fetch(`${API}/api/tickets/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch)
  });
  if (!res.ok) throw new Error('Failed to update ticket');
  return res.json();
}
