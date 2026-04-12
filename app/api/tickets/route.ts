import { after } from 'next/server';
import { generateText } from 'ai';
import { gateway } from '@/lib/provider';
import { ticketStore } from '@/lib/store';
import { teamStore } from '@/lib/teamStore';
import { agentStore } from '@/lib/agentStore';
import { enrichTicket } from '@/lib/enrichTicket';
import type { SupportTicket } from '@/lib/types';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const status = searchParams.get('status') ?? undefined;
  const tickets = await ticketStore.list(status);
  return Response.json({ tickets });
}

export async function POST(req: Request) {
  const { messageText, channelId = 'chat', multiAgent = true }: { messageText: string; channelId?: string; multiAgent?: boolean } = await req.json();

  const { text: title } = await generateText({
    model: gateway('openai/gpt-4.1-mini'),
    maxRetries: 5,
    providerOptions: { gateway: { models: ['anthropic/claude-haiku-4.5', 'google/gemini-2.5-flash-lite'] } },
    prompt: `Summarize this support message as a short ticket title (max 10 words, no punctuation at end):\n\n"${messageText}"`,
  });

  const now = new Date().toISOString();
  const ticket: SupportTicket = {
    id: crypto.randomUUID(),
    status: 'open',
    input: {
      messageText,
      channelId,
      threadTs: Date.now().toString(),
      userId: 'chat-user',
      triggeredAt: now,
    },
    extractedQuestion: title.trim(),
    publicDocsContent: '',
    notionContent: '',
    replicationResult: '',
    aiAnalysis: '',
    aiDraftReply: '',
    createdAt: now,
    updatedAt: now,
  };

  await ticketStore.create(ticket);
  after(async () => {
    const [assignment, agents] = await Promise.all([
      teamStore.getChannelAssignment(channelId),
      agentStore.list(),
    ]);
    const agentConfig = assignment?.agentId ? agents.find(a => a.id === assignment.agentId) : undefined;
    await enrichTicket(ticket.id, messageText, agentConfig, {
      stripeCustomerId: assignment?.stripeCustomerId,
      secretKey: assignment?.secretKey,
    }, { multiAgent });
  });
  return Response.json({ ticket }, { status: 201 });
}
