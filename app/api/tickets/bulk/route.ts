import { ticketStore } from '@/lib/store';

export async function POST(req: Request) {
  const { ids, archived }: { ids: string[]; archived: boolean } = await req.json();

  if (!Array.isArray(ids) || ids.length === 0) {
    return Response.json({ error: 'ids required' }, { status: 400 });
  }

  const now = new Date().toISOString();
  await Promise.all(ids.map(id => ticketStore.update(id, { archived, updatedAt: now })));

  return Response.json({ updated: ids.length });
}
