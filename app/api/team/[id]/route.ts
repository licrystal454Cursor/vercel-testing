import { teamStore } from '@/lib/teamStore';

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  await teamStore.removeMember(id);
  return new Response(null, { status: 204 });
}
