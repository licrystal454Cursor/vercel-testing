import { ticketStore } from '@/lib/store';
import { chatStore } from '@/lib/chatStore';
import { appendResolvedTicketDebrief } from '@/lib/appendResolvedTicketDebrief';
import type { SupportTicket } from '@/lib/types';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const ticket = await ticketStore.get(id);

  if (!ticket) {
    return Response.json({ error: 'Not found' }, { status: 404 });
  }

  return Response.json({ ticket });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const patch = await req.json() as Partial<SupportTicket>;

  const ticket = await ticketStore.get(id);
  if (!ticket) {
    return Response.json({ error: 'Not found' }, { status: 404 });
  }

  const now = new Date().toISOString();
  const isResolving = patch.status === 'resolved' && ticket.status !== 'resolved';
  const nextPatch: Partial<SupportTicket> = {
    ...patch,
    updatedAt: now,
    ...(isResolving ? { resolvedAt: patch.resolvedAt ?? now } : {}),
  };

  await ticketStore.update(id, nextPatch);
  if (patch.archived === true) {
    await chatStore.deleteByTicket(id);
  }

  if (isResolving) {
    try {
      await appendResolvedTicketDebrief(id);
    } catch (error) {
      console.error('[tickets.patch] failed to append resolved ticket debrief', error);
    }
  }

  const updated = await ticketStore.get(id);
  return Response.json({ ticket: updated });
}
