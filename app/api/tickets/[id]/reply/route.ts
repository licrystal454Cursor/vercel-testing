import { ticketStore } from '@/lib/store';

async function postSlackReply(
  channel: string,
  threadTs: string,
  text: string
): Promise<void> {
  const res = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ channel, thread_ts: threadTs, text }),
  });
  const data = await res.json() as { ok: boolean; error?: string };
  if (!data.ok) {
    throw new Error(`Slack error: ${data.error ?? 'unknown'}`);
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { reply } = await req.json() as { reply: string };

  if (!reply?.trim()) {
    return Response.json({ error: 'Reply text is required' }, { status: 400 });
  }

  const ticket = await ticketStore.get(id);
  if (!ticket) {
    return Response.json({ error: 'Ticket not found' }, { status: 404 });
  }

  if (ticket.status === 'resolved') {
    return Response.json({ error: 'Ticket is already resolved' }, { status: 409 });
  }

  // Post to the original Slack thread (skip if ticket came from the chat UI)
  if (ticket.input.channelId !== 'chat') {
    try {
      await postSlackReply(ticket.input.channelId, ticket.input.threadTs, reply);
    } catch (err) {
      console.error('[reply] Slack post failed:', err);
      return Response.json(
        { error: err instanceof Error ? err.message : 'Slack post failed' },
        { status: 502 }
      );
    }
  }

  try {
    const now = new Date().toISOString();
    await ticketStore.update(id, {
      status: 'waiting_on_customer',
      sentReply: reply,
      updatedAt: now,
    });

    const updated = await ticketStore.get(id);
    return Response.json({ ticket: updated });
  } catch (err) {
    console.error('[reply] DB update failed:', err);
    return Response.json(
      { error: err instanceof Error ? err.message : 'Database error' },
      { status: 500 }
    );
  }
}
