import { createAgentUIStreamResponse, type UIMessage } from 'ai';
import { createTicketChatAgent } from '@/lib/chat/createTicketChatAgent';
import { loadTicketChatContext } from '@/lib/chat/loadTicketChatContext';
import { consumeSseStream, createPersistChatFinish, logChatStep } from '@/lib/chat/streamCallbacks';

// Thin route handler: parse the incoming message, hydrate chat context, build
// the ticket agent, and hand off streaming plus persistence to shared helpers.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json() as { message: UIMessage; id: string };
  const newMessage = body.message;

  const context = await loadTicketChatContext(id, newMessage);
  if (!context) {
    return Response.json({ error: 'Not found' }, { status: 404 });
  }

  const { agent, stripeToolkit } = await createTicketChatAgent({
    ticketId: id,
    ticket: context.ticket,
    agentConfig: context.agentConfig,
    prefetchedNotionPages: context.prefetchedNotionPages,
    stripeCustomerId: context.stripeCustomerId,
    channelSecretKey: context.channelSecretKey,
  });

  return createAgentUIStreamResponse({
    agent,
    uiMessages: context.uiMessages,
    consumeSseStream,
    onStepFinish: logChatStep,
    onFinish: createPersistChatFinish({
      ticketId: id,
      stripeToolkit,
    }),
  });
}
