import { createClient } from '@supabase/supabase-js';
import type { AgentConfig } from './types';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function toAgent(row: Record<string, unknown>): AgentConfig {
  return {
    id: row.id as string,
    name: row.name as string,
    instructions: row.instructions as string,
    createdAt: row.created_at as string,
  };
}

export const agentStore = {
  async list(): Promise<AgentConfig[]> {
    const { data, error } = await supabase
      .from('agents')
      .select('*')
      .order('created_at', { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []).map(toAgent);
  },

  async create(name: string, instructions: string): Promise<AgentConfig> {
    const { data, error } = await supabase
      .from('agents')
      .insert({ name, instructions })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return toAgent(data);
  },

  async updateContent(id: string, instructions: string): Promise<void> {
    const { error } = await supabase.from('agents').update({ instructions }).eq('id', id);
    if (error) throw new Error(error.message);
  },

  async remove(id: string): Promise<void> {
    const { error } = await supabase.from('agents').delete().eq('id', id);
    if (error) throw new Error(error.message);
  },
};
