import { after } from 'next/server';
import { createOpenAI } from '@ai-sdk/openai';
import { generateText } from 'ai';
import { ticketStore } from '@/lib/store';
import { enrichTicket } from '@/lib/enrichTicket';
import type { SupportTicket } from '@/lib/types';

const gateway = createOpenAI({
  baseURL: 'https://ai-gateway.vercel.sh/v1',
  apiKey: process.env.AI_GATEWAY_KEY,
});

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const status = searchParams.get('status') ?? undefined;
  const tickets = await ticketStore.list(status);
  return Response.json({ tickets });
}

export async function POST(req: Request) {
  const { messageText }: { messageText: string } = await req.json();

  const { text: title } = await generateText({
    model: gateway('openai/gpt-4.1-mini'),
    prompt: `Summarize this support message as a short ticket title (max 10 words, no punctuation at end):\n\n"${messageText}"`,
  });

  const now = new Date().toISOString();
  const ticket: SupportTicket = {
    id: crypto.randomUUID(),
    status: 'open',
    input: {
      messageText,
      channelId: 'chat',
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
  after(() => enrichTicket(ticket.id, messageText));
  return Response.json({ ticket }, { status: 201 });
}
