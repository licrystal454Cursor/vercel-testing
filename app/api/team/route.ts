import { teamStore } from '@/lib/teamStore';

export async function GET() {
  const members = await teamStore.listMembers();
  return Response.json({ members });
}

export async function POST(req: Request) {
  const { name, email } = await req.json() as { name: string; email: string };
  if (!name?.trim() || !email?.trim()) {
    return Response.json({ error: 'Name and email are required' }, { status: 400 });
  }
  const member = await teamStore.addMember(name.trim(), email.trim());
  return Response.json({ member }, { status: 201 });
}
