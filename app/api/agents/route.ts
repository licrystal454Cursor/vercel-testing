import { agentStore } from '@/lib/agentStore';

export async function GET() {
  const agents = await agentStore.list();
  return Response.json({ agents });
}

export async function POST(req: Request) {
  const { name, instructions } = await req.json() as {
    name: string;
    instructions: string;
  };
  if (!name?.trim() || !instructions?.trim()) {
    return Response.json({ error: 'name and instructions are required' }, { status: 400 });
  }
  const agent = await agentStore.create(name.trim(), instructions.trim());
  return Response.json({ agent }, { status: 201 });
}
