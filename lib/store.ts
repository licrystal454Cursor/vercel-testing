import { createClient } from '@supabase/supabase-js';
import type { SupportTicket } from './types';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Map between DB row (snake_case) and SupportTicket (camelCase)
function toTicket(row: Record<string, string>): SupportTicket {
  return {
    id: row.id,
    status: row.status as 'open' | 'waiting_on_customer' | 'resolved',
    input: {
      messageText: row.message_text,
      channelId: row.channel_id,
      channelName: row.channel_name ?? undefined,
      threadTs: row.thread_ts,
      userId: row.user_id,
      triggeredAt: row.triggered_at,
    },
    extractedQuestion: row.extracted_question,
    publicDocsContent: row.public_docs_content,
    notionContent: row.notion_content,
    replicationResult: row.replication_result,
    aiAnalysis: row.ai_analysis,
    aiDraftReply: row.ai_draft_reply,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    resolvedAt: row.resolved_at ?? undefined,
    sentReply: row.sent_reply ?? undefined,
    lastCustomerMessage: row.last_customer_message ?? undefined,
    archived: Boolean(row.archived),
    assigneeId: row.assignee_id ?? undefined,
  };
}

function toRow(ticket: SupportTicket) {
  return {
    id: ticket.id,
    status: ticket.status,
    message_text: ticket.input.messageText,
    channel_id: ticket.input.channelId,
    channel_name: ticket.input.channelName ?? null,
    thread_ts: ticket.input.threadTs,
    user_id: ticket.input.userId,
    triggered_at: ticket.input.triggeredAt,
    extracted_question: ticket.extractedQuestion,
    public_docs_content: ticket.publicDocsContent,
    notion_content: ticket.notionContent,
    replication_result: ticket.replicationResult,
    ai_analysis: ticket.aiAnalysis,
    ai_draft_reply: ticket.aiDraftReply,
    created_at: ticket.createdAt,
    updated_at: ticket.updatedAt,
    resolved_at: ticket.resolvedAt ?? null,
    sent_reply: ticket.sentReply ?? null,
  };
}

export const ticketStore = {
  async list(status?: string): Promise<SupportTicket[]> {
    let query = supabase
      .from('tickets')
      .select('*')
      .order('created_at', { ascending: false });

    if (status === 'archived') {
      query = query.eq('archived', true);
    } else {
      query = query.eq('archived', false);
      if (status) query = query.eq('status', status);
    }

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return (data ?? []).map(toTicket);
  },

  async get(id: string): Promise<SupportTicket | undefined> {
    const { data, error } = await supabase
      .from('tickets')
      .select('*')
      .eq('id', id)
      .single();

    if (error) return undefined;
    return toTicket(data);
  },

  async create(ticket: SupportTicket): Promise<SupportTicket> {
    const { error } = await supabase.from('tickets').insert(toRow(ticket));
    if (error) throw new Error(error.message);
    return ticket;
  },

  async update(id: string, patch: Partial<SupportTicket>): Promise<void> {
    const columnMap: Record<string, string> = {
      status: 'status',
      extractedQuestion: 'extracted_question',
      publicDocsContent: 'public_docs_content',
      notionContent: 'notion_content',
      replicationResult: 'replication_result',
      aiAnalysis: 'ai_analysis',
      aiDraftReply: 'ai_draft_reply',
      updatedAt: 'updated_at',
      resolvedAt: 'resolved_at',
      sentReply: 'sent_reply',
      lastCustomerMessage: 'last_customer_message',
      archived: 'archived',
      assigneeId: 'assignee_id',
    };
    const row: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(patch)) {
      const col = columnMap[key];
      if (col) row[col] = value ?? null;
    }
    const { error } = await supabase.from('tickets').update(row).eq('id', id);
    if (error) throw new Error(error.message);
  },
};
