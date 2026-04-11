import { teamStore } from '@/lib/teamStore';

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json() as { agentId?: string | null; stripeCustomerId?: string | null };
  if ('agentId' in body) await teamStore.updateChannelAgent(id, body.agentId ?? null);
  if ('stripeCustomerId' in body) await teamStore.updateChannelStripeCustomer(id, body.stripeCustomerId ?? null);
  return new Response(null, { status: 204 });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  await teamStore.removeChannelAssignment(id);
  return new Response(null, { status: 204 });
}
