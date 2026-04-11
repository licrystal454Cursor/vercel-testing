export interface TeamMember {
  id: string;
  name: string;
  email: string;
  createdAt: string;
}

export interface AgentConfig {
  id: string;
  name: string;
  instructions: string;
  createdAt: string;
}

export interface ChannelAssignment {
  id: string;
  channelId: string;
  channelName: string;
  assigneeId: string;
  agentId?: string;
  stripeCustomerId?: string;
  secretKey?: string;
  createdAt: string;
}

export interface SupportTicketInput {
  messageText: string;
  channelId: string;
  channelName?: string;
  threadTs: string;
  userId: string;
  triggeredAt: string;
}

export interface SupportTicket {
  id: string;
  status: 'open' | 'waiting_on_customer' | 'resolved';
  input: SupportTicketInput;
  extractedQuestion: string;
  publicDocsContent: string;
  notionContent: string;
  replicationResult: string;
  aiAnalysis: string;
  aiDraftReply: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
  sentReply?: string;
  lastCustomerMessage?: string;
  archived?: boolean;
  assigneeId?: string;
}
