export interface SupportTicketInput {
  messageText: string;
  channelId: string;
  threadTs: string;
  userId: string;
  triggeredAt: string;
}

export interface SupportTicket {
  id: string;
  status: 'open' | 'resolved';
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
}
