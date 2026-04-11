import { teamStore } from '@/lib/teamStore';

export async function GET() {
  const assignments = await teamStore.listChannelAssignments();
  return Response.json({ assignments });
}

export async function POST(req: Request) {
  const { channelId, channelName, assigneeId, agentId, stripeCustomerId } = await req.json() as {
    channelId: string;
    channelName: string;
    assigneeId: string;
    agentId?: string;
    stripeCustomerId?: string;
  };
  if (!channelId?.trim() || !assigneeId?.trim()) {
    return Response.json({ error: 'channelId and assigneeId are required' }, { status: 400 });
  }
  const assignment = await teamStore.addChannelAssignment(
    channelId.trim(),
    channelName?.trim() || channelId.trim(),
    assigneeId.trim(),
    agentId?.trim() || undefined,
    stripeCustomerId?.trim() || undefined,
  );
  return Response.json({ assignment }, { status: 201 });
}
