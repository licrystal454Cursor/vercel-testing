import { ticketStore } from '@/lib/store';
import { chatStore } from '@/lib/chatStore';
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

  await ticketStore.update(id, { ...patch, updatedAt: new Date().toISOString() });
  if (patch.archived === true) {
    await chatStore.deleteByTicket(id);
  }
  const updated = await ticketStore.get(id);
  return Response.json({ ticket: updated });
}
