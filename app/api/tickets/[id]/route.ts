import { ticketStore } from '@/lib/store';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const ticket = ticketStore.get(id);

  if (!ticket) {
    return Response.json({ error: 'Not found' }, { status: 404 });
  }

  return Response.json({ ticket });
}
