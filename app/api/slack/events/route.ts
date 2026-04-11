import { after } from 'next/server';
import { createOpenAI } from '@ai-sdk/openai';
import { generateText } from 'ai';
import { ticketStore } from '@/lib/store';
import { teamStore } from '@/lib/teamStore';
import { agentStore } from '@/lib/agentStore';
import { enrichTicket } from '@/lib/enrichTicket';
import type { SupportTicket } from '@/lib/types';

const gateway = createOpenAI({
  baseURL: 'https://ai-gateway.vercel.sh/v1',
  apiKey: process.env.AI_GATEWAY_KEY,
});

const enc = new TextEncoder();

async function verifySlackSignature(
  headers: Headers,
  rawBody: string
): Promise<boolean> {
  const timestamp = headers.get('x-slack-request-timestamp');
  const slackSig = headers.get('x-slack-signature');

  if (!timestamp || !slackSig) return false;

  // Reject requests older than 5 minutes (replay attack protection)
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;

  const sigbase = `v0:${timestamp}:${rawBody}`;
  const secret = process.env.SLACK_SIGNING_SECRET;
  if (!secret) return false;

  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(sigbase));
  const computed =
    'v0=' +
    Array.from(new Uint8Array(sig))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

  // Constant-time comparison
  if (computed.length !== slackSig.length) return false;
  const a = enc.encode(computed);
  const b = enc.encode(slackSig);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function fetchChannelName(channelId: string): Promise<string | undefined> {
  try {
    const res = await fetch(`https://slack.com/api/conversations.info?channel=${channelId}`, {
      headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` },
    });
    const data = await res.json() as { ok: boolean; channel?: { name: string } };
    return data.ok ? `#${data.channel?.name}` : undefined;
  } catch {
    return undefined;
  }
}

/** React to the message at `timestamp` (message `ts` in the event payload). */
async function addSlackReaction(
  channel: string,
  timestamp: string,
  name: string
): Promise<void> {
  const res = await fetch('https://slack.com/api/reactions.add', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ channel, timestamp, name }),
  });
  const data = (await res.json()) as { ok?: boolean; error?: string };
  if (data.ok || data.error === 'already_reacted') {
    console.log('[slack] reactions.add ok:', name, '| ts:', timestamp);
  } else {
    console.error(
      '[slack] reactions.add failed:',
      data.error ?? res.status,
      '| channel:',
      channel,
      '| ts:',
      timestamp,
      '(add reactions:write scope and reinstall app if missing_scope)'
    );
  }
}

export async function POST(req: Request) {
  const rawBody = await req.text();
  console.log('[slack] raw body type:', JSON.parse(rawBody).type, '| event type:', JSON.parse(rawBody).event?.type);

  const body = JSON.parse(rawBody);

  // Slack URL verification handshake — handle before signature check
  if (body.type === 'url_verification') {
    console.log('[slack] url_verification challenge:', body.challenge);
    return Response.json({ challenge: body.challenge });
  }

  const valid = await verifySlackSignature(req.headers, rawBody);
  console.log('[slack] signature valid:', valid);
  if (!valid) return new Response('Unauthorized', { status: 401 });

  console.log('[slack] event received:', body.event?.type, {
    subtype: body.event?.subtype,
    bot_id: body.event?.bot_id,
    thread_ts: body.event?.thread_ts,
    ts: body.event?.ts,
    text: body.event?.text?.slice(0, 80),
  });

  if (body.type === 'event_callback' && body.event?.type === 'message') {
    const { text, channel, thread_ts, ts, bot_id, subtype } = body.event;

    console.log('[slack] message event — bot_id:', bot_id, '| subtype:', subtype, '| thread_ts:', thread_ts, '| ts:', ts);
    // Ignore bot messages and system subtypes (channel_join, etc.)
    if (bot_id || subtype) return new Response(null, { status: 200 });
    // Only care about thread replies (thread_ts present and different from ts)
    if (!thread_ts || thread_ts === ts) return new Response(null, { status: 200 });

    after(async () => {
      // Find the existing ticket for this thread
      const allTickets = await ticketStore.list();
      const ticket = allTickets.find(t => t.input.threadTs === thread_ts && t.input.channelId === channel);
      console.log('[slack] thread reply — thread_ts:', thread_ts, '| channel:', channel, '| ticket found:', ticket?.id ?? 'NONE', '| all threadTs:', allTickets.map(t => t.input.threadTs));
      if (!ticket) return; // No ticket for this thread — ignore
      if (ticket.status === 'resolved') return; // Already resolved — ignore

      const messageText = text?.replace(/<@[A-Z0-9]+>\s*/g, '').trim() ?? '';
      console.log('[slack] customer message text:', messageText);
      if (!messageText) return;

      // Detect if this message signals resolution
      const { text: verdict } = await generateText({
        model: gateway('openai/gpt-4.1-mini'),
        prompt: `Does the following customer message signal that their issue has been resolved? Reply with only "yes" or "no".\n\nMessage: "${messageText}"`,
      });

      const now = new Date().toISOString();
      if (verdict.trim().toLowerCase().startsWith('yes')) {
        await ticketStore.update(ticket.id, {
          status: 'resolved',
          lastCustomerMessage: messageText,
          resolvedAt: now,
          updatedAt: now,
        });
      } else {
        // Customer replied but issue not resolved — reopen and re-enrich with full conversation context
        await ticketStore.update(ticket.id, {
          status: 'open',
          lastCustomerMessage: messageText,
          updatedAt: now,
        });
        const conversationContext = [
          `Original issue: ${ticket.input.messageText}`,
          ticket.sentReply ? `Support replied: ${ticket.sentReply}` : '',
          `Customer follow-up: ${messageText}`,
        ].filter(Boolean).join('\n\n');
        const assignmentForThread = await teamStore.getChannelAssignment(channel);
        const agentConfigForThread = assignmentForThread?.agentId
          ? (await agentStore.list()).find(a => a.id === assignmentForThread.agentId)
          : undefined;
        await enrichTicket(ticket.id, conversationContext, agentConfigForThread, {
          stripeCustomerId: assignmentForThread?.stripeCustomerId,
          secretKey: assignmentForThread?.secretKey,
        });
      }
    });
  }

  if (body.type === 'event_callback' && body.event?.type === 'app_mention') {
    const { text, channel, ts, thread_ts, user, bot_id } = body.event;

    // Ignore messages from bots
    if (bot_id) return new Response(null, { status: 200 });

    after(async () => {
      const allTickets = await ticketStore.list();

      // If this @mention is inside an existing ticket's thread, treat it as a
      // customer follow-up — not a new ticket. thread_ts points to the parent.
      const parentTs = thread_ts && thread_ts !== ts ? thread_ts : null;
      if (parentTs) {
        const existingTicket = allTickets.find(
          t => t.input.threadTs === parentTs && t.input.channelId === channel
        );
        if (existingTicket && existingTicket.status !== 'resolved') {
          const messageText = text.replace(/<@[A-Z0-9]+>\s*/g, '').trim();
          if (!messageText) return;

          const { text: verdict } = await generateText({
            model: gateway('openai/gpt-4.1-mini'),
            prompt: `Does the following customer message signal that their issue has been resolved? Reply with only "yes" or "no".\n\nMessage: "${messageText}"`,
          });

          const now = new Date().toISOString();
          if (verdict.trim().toLowerCase().startsWith('yes')) {
            await ticketStore.update(existingTicket.id, { status: 'resolved', lastCustomerMessage: messageText, resolvedAt: now, updatedAt: now });
          } else {
            await ticketStore.update(existingTicket.id, { status: 'open', lastCustomerMessage: messageText, updatedAt: now });
            const conversationContext = [
              `Original issue: ${existingTicket.input.messageText}`,
              existingTicket.sentReply ? `Support replied: ${existingTicket.sentReply}` : '',
              `Customer follow-up: ${messageText}`,
            ].filter(Boolean).join('\n\n');
            const assignmentMention = await teamStore.getChannelAssignment(channel);
            const agentConfigMention = assignmentMention?.agentId
              ? (await agentStore.list()).find(a => a.id === assignmentMention.agentId)
              : undefined;
            await enrichTicket(existingTicket.id, conversationContext, agentConfigMention, {
              stripeCustomerId: assignmentMention?.stripeCustomerId,
              secretKey: assignmentMention?.secretKey,
            });
          }
          return;
        }
      }

      // Idempotency: Slack retries if it doesn't get a 200 within 3s. Still try to
      // react — first delivery may have created the ticket then failed before reacting.
      if (allTickets.some(t => t.input.threadTs === ts)) {
        await addSlackReaction(channel, ts, 'eyes');
        return;
      }

      // Strip the bot mention (<@UXXXXXX>) from the message
      const messageText = text.replace(/<@[A-Z0-9]+>\s*/g, '').trim();
      if (!messageText) return;

      const { text: title } = await generateText({
        model: gateway('openai/gpt-4.1-mini'),
        prompt: `Summarize this support message as a short ticket title (max 10 words, no punctuation at end):\n\n"${messageText}"`,
      });

      const now = new Date().toISOString();
      const [assignment, channelName] = await Promise.all([
        teamStore.getChannelAssignment(channel),
        fetchChannelName(channel),
      ]);
      const agents = assignment?.agentId ? await agentStore.list() : [];
      const agentConfig = assignment?.agentId ? agents.find(a => a.id === assignment.agentId) : undefined;
      const ticket: SupportTicket = {
        id: crypto.randomUUID(),
        status: 'open',
        input: {
          messageText,
          channelId: channel,
          channelName,
          threadTs: ts,
          userId: user,
          triggeredAt: now,
        },
        assigneeId: assignment?.assigneeId,
        extractedQuestion: title.trim(),
        publicDocsContent: '',
        notionContent: '',
        replicationResult: '',
        aiAnalysis: '',
        aiDraftReply: '',
        createdAt: now,
        updatedAt: now,
      };

      await ticketStore.create(ticket);
      await addSlackReaction(channel, ts, 'eyes');
      await enrichTicket(ticket.id, messageText, agentConfig, {
        stripeCustomerId: assignment?.stripeCustomerId,
        secretKey: assignment?.secretKey,
      });
    });
  }

  return new Response(null, { status: 200 });
}
