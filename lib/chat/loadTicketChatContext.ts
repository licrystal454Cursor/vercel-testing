import type { UIMessage } from 'ai';
import { agentStore } from '../agentStore';
import { chatStore } from '../chatStore';
import { prefetchInstructionNotionPages, type PrefetchedNotionPage } from '../notionInstructionContext';
import { ticketStore } from '../store';
import { teamStore } from '../teamStore';
import type { AgentConfig, SupportTicket } from '../types';

function getUserText(message: UIMessage): string {
  const userTextPart = (message.parts ?? []).find(
    (part): part is { type: 'text'; text: string } => part.type === 'text',
  );
  return userTextPart?.text ?? '';
}

function toStoredUIMessage(message: { id: string; role: string; content: string }): UIMessage {
  return {
    id: message.id,
    role: message.role as 'user' | 'assistant',
    parts: [{ type: 'text' as const, text: message.content }],
  };
}

export interface LoadedTicketChatContext {
  ticket: SupportTicket;
  agentConfig?: AgentConfig;
  prefetchedNotionPages: PrefetchedNotionPage[];
  stripeCustomerId: string | null;
  channelSecretKey: string | null;
  uiMessages: UIMessage[];
}

// Hydrates everything the ticket chat route needs in one place: persisted chat
// history, ticket metadata, selected agent config, Notion context, and Stripe
// account context for the current channel.
export async function loadTicketChatContext(
  ticketId: string,
  newMessage: UIMessage,
): Promise<LoadedTicketChatContext | null> {
  const userText = getUserText(newMessage);
  if (userText) {
    await chatStore.save(ticketId, newMessage.id, 'user', userText);
  }

  const [dbMessages, ticket] = await Promise.all([
    chatStore.list(ticketId),
    ticketStore.get(ticketId),
  ]);
  if (!ticket) return null;

  const uiMessages: UIMessage[] = [
    ...dbMessages
      .filter(message => message.id !== newMessage.id)
      .map(toStoredUIMessage),
    newMessage,
  ];

  let agentConfig: AgentConfig | undefined;
  const channelId = ticket.input.channelId;
  if (channelId) {
    const agentId = await teamStore.getAgentForChannel(channelId);
    if (agentId) {
      const agents = await agentStore.list();
      agentConfig = agents.find(agent => agent.id === agentId);
    }
  }

  const prefetchedNotionPages = await prefetchInstructionNotionPages(agentConfig?.instructions);
  const msgCustomerId = ticket.input.messageText.match(/cus_[a-zA-Z0-9]+/)?.[0];
  const [stripeCustomerId, channelSecretKey] = await Promise.all([
    msgCustomerId
      ? Promise.resolve(msgCustomerId)
      : teamStore.getStripeCustomerForChannel(ticket.input.channelId),
    teamStore.getSecretKeyForChannel(ticket.input.channelId),
  ]);

  return {
    ticket,
    agentConfig,
    prefetchedNotionPages,
    stripeCustomerId,
    channelSecretKey,
    uiMessages,
  };
}
