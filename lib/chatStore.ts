import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export interface ChatMessage {
  id: string;
  role: string;
  content: string;
  createdAt: string;
}

export const chatStore = {
  async list(ticketId: string): Promise<ChatMessage[]> {
    const { data, error } = await supabase
      .from('chat_messages')
      .select('*')
      .eq('ticket_id', ticketId)
      .order('created_at', { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []).map(row => ({
      id: row.id as string,
      role: row.role as string,
      content: row.content as string,
      createdAt: row.created_at as string,
    }));
  },

  async save(ticketId: string, messageId: string, role: string, content: string): Promise<void> {
    const { error } = await supabase.from('chat_messages').upsert(
      { id: messageId, ticket_id: ticketId, role, content },
      { onConflict: 'id', ignoreDuplicates: true }
    );
    if (error) throw new Error(error.message);
  },

  async deleteByTicket(ticketId: string): Promise<void> {
    const { error } = await supabase.from('chat_messages').delete().eq('ticket_id', ticketId);
    if (error) throw new Error(error.message);
  },
};
