import { createClient } from '@supabase/supabase-js';
import type { TeamMember, ChannelAssignment } from './types';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function toMember(row: Record<string, string>): TeamMember {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    createdAt: row.created_at,
  };
}

function toAssignment(row: Record<string, string>): ChannelAssignment {
  return {
    id: row.id,
    channelId: row.channel_id,
    channelName: row.channel_name,
    assigneeId: row.assignee_id,
    agentId: row.agent_id ?? undefined,
    stripeCustomerId: row.stripe_customer_id ?? undefined,
    secretKey: row.secret_key ?? undefined,
    createdAt: row.created_at,
  };
}

export const teamStore = {
  async listMembers(): Promise<TeamMember[]> {
    const { data, error } = await supabase
      .from('team_members')
      .select('*')
      .order('created_at', { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []).map(toMember);
  },

  async addMember(name: string, email: string): Promise<TeamMember> {
    const { data, error } = await supabase
      .from('team_members')
      .insert({ name, email })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return toMember(data);
  },

  async removeMember(id: string): Promise<void> {
    const { error } = await supabase.from('team_members').delete().eq('id', id);
    if (error) throw new Error(error.message);
  },

  async listChannelAssignments(): Promise<ChannelAssignment[]> {
    const { data, error } = await supabase
      .from('channel_assignments')
      .select('*')
      .order('created_at', { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []).map(toAssignment);
  },

  async addChannelAssignment(
    channelId: string,
    channelName: string,
    assigneeId: string,
    agentId?: string,
    stripeCustomerId?: string,
  ): Promise<ChannelAssignment> {
    const { data, error } = await supabase
      .from('channel_assignments')
      .upsert(
        {
          channel_id: channelId,
          channel_name: channelName,
          assignee_id: assigneeId,
          agent_id: agentId ?? null,
          stripe_customer_id: stripeCustomerId ?? null,
        },
        { onConflict: 'channel_id' }
      )
      .select()
      .single();
    if (error) throw new Error(error.message);
    return toAssignment(data);
  },

  async removeChannelAssignment(id: string): Promise<void> {
    const { error } = await supabase.from('channel_assignments').delete().eq('id', id);
    if (error) throw new Error(error.message);
  },

  async getAssigneeForChannel(channelId: string): Promise<string | null> {
    const { data } = await supabase
      .from('channel_assignments')
      .select('assignee_id')
      .eq('channel_id', channelId)
      .single();
    return data?.assignee_id ?? null;
  },

  async updateChannelAgent(id: string, agentId: string | null): Promise<void> {
    const { error } = await supabase
      .from('channel_assignments')
      .update({ agent_id: agentId })
      .eq('id', id);
    if (error) throw new Error(error.message);
  },

  async getAgentForChannel(channelId: string): Promise<string | null> {
    const { data } = await supabase
      .from('channel_assignments')
      .select('agent_id')
      .eq('channel_id', channelId)
      .single();
    return data?.agent_id ?? null;
  },

  async getChannelAssignment(channelId: string): Promise<ChannelAssignment | null> {
    const { data } = await supabase
      .from('channel_assignments')
      .select('*')
      .eq('channel_id', channelId)
      .single();
    return data ? toAssignment(data) : null;
  },

  async getStripeCustomerForChannel(channelId: string): Promise<string | null> {
    const { data } = await supabase
      .from('channel_assignments')
      .select('stripe_customer_id')
      .eq('channel_id', channelId)
      .single();
    return data?.stripe_customer_id ?? null;
  },

  async getSecretKeyForChannel(channelId: string): Promise<string | null> {
    const { data } = await supabase
      .from('channel_assignments')
      .select('secret_key')
      .eq('channel_id', channelId)
      .single();
    return data?.secret_key ?? null;
  },

  async updateChannelStripeCustomer(id: string, stripeCustomerId: string | null): Promise<void> {
    const { error } = await supabase
      .from('channel_assignments')
      .update({ stripe_customer_id: stripeCustomerId })
      .eq('id', id);
    if (error) throw new Error(error.message);
  },

  async uniqueChannelsFromTickets(): Promise<{ channelId: string; channelName?: string }[]> {
    const { data, error } = await supabase
      .from('tickets')
      .select('channel_id, channel_name')
      .neq('channel_id', 'chat');
    if (error) throw new Error(error.message);
    const seen = new Map<string, string | undefined>();
    for (const r of data ?? []) {
      if (!seen.has(r.channel_id)) {
        seen.set(r.channel_id, r.channel_name ?? undefined);
      }
    }
    return Array.from(seen.entries()).map(([channelId, channelName]) => ({ channelId, channelName }));
  },
};
