import { agentStore } from '@/lib/agentStore';

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { instructions } = await req.json() as { instructions: string };
  await agentStore.updateContent(id, instructions ?? '');
  return new Response(null, { status: 204 });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await agentStore.remove(id);
  return new Response(null, { status: 204 });
}
