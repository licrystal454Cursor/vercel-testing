import Link from 'next/link';
import { teamStore } from '@/lib/teamStore';
import { agentStore } from '@/lib/agentStore';
import { TeamPageClient } from '@/components/TeamPageClient';
export const dynamic = 'force-dynamic';

async function fetchSlackChannels(): Promise<{ channelId: string; channelName: string }[]> {
  const channels: { channelId: string; channelName: string }[] = [];
  let cursor: string | undefined;

  try {
    do {
      const url = new URL('https://slack.com/api/conversations.list');
      url.searchParams.set('limit', '200');
      url.searchParams.set('exclude_archived', 'true');
      if (cursor) url.searchParams.set('cursor', cursor);

      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` },
      });
      const data = await res.json() as {
        ok: boolean;
        channels?: { id: string; name: string }[];
        response_metadata?: { next_cursor?: string };
      };

      if (!data.ok) break;
      for (const ch of data.channels ?? []) {
        channels.push({ channelId: ch.id, channelName: `#${ch.name}` });
      }
      cursor = data.response_metadata?.next_cursor || undefined;
    } while (cursor);
  } catch {
    // Fall back to ticket history if Slack API is unavailable
    return (await teamStore.uniqueChannelsFromTickets()).map(c => ({
      channelId: c.channelId,
      channelName: c.channelName ?? c.channelId,
    }));
  }

  return channels;
}

export default async function TeamPage() {
  const [members, assignments, channels, agents] = await Promise.all([
    teamStore.listMembers(),
    teamStore.listChannelAssignments(),
    fetchSlackChannels(),
    agentStore.list(),
  ]);

  return (
    <main className="max-w-3xl mx-auto px-4 py-10">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold">Team</h1>
          <p className="text-sm text-slate-500 mt-1">Manage support agents and channel routing</p>
        </div>
        <Link href="/tickets" className="text-sm text-slate-500 hover:text-slate-900">
          ← Back to tickets
        </Link>
      </div>
      <TeamPageClient
        initialMembers={members}
        initialAssignments={assignments}
        availableChannels={channels}
        initialAgents={agents}
      />
    </main>
  );
}
