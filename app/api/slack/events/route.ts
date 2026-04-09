import { after } from 'next/server';
import { createOpenAI } from '@ai-sdk/openai';
import { generateText } from 'ai';
import { ticketStore } from '@/lib/store';
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

async function postSlackReply(
  channel: string,
  threadTs: string,
  text: string
): Promise<void> {
  await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ channel, thread_ts: threadTs, text }),
  });
}

export async function POST(req: Request) {
  const rawBody = await req.text();
  const body = JSON.parse(rawBody);

  // Slack URL verification handshake — handle before signature check
  if (body.type === 'url_verification') {
    console.log('[slack] url_verification challenge:', body.challenge);
    return Response.json({ challenge: body.challenge });
  }

  const valid = await verifySlackSignature(req.headers, rawBody);
  if (!valid) return new Response('Unauthorized', { status: 401 });

  if (body.type === 'event_callback' && body.event?.type === 'app_mention') {
    const { text, channel, ts, user, bot_id } = body.event;

    // Ignore messages from bots
    if (bot_id) return new Response(null, { status: 200 });

    after(async () => {
      // Idempotency: Slack retries if it doesn't get a 200 within 3s
      const existing = await ticketStore.list();
      if (existing.some(t => t.input.threadTs === ts)) return;

      // Strip the bot mention (<@UXXXXXX>) from the message
      const messageText = text.replace(/<@[A-Z0-9]+>\s*/g, '').trim();
      if (!messageText) return;

      const { text: title } = await generateText({
        model: gateway('openai/gpt-4.1-mini'),
        prompt: `Summarize this support message as a short ticket title (max 10 words, no punctuation at end):\n\n"${messageText}"`,
      });

      const now = new Date().toISOString();
      const ticket: SupportTicket = {
        id: crypto.randomUUID(),
        status: 'open',
        input: {
          messageText,
          channelId: channel,
          threadTs: ts,
          userId: user,
          triggeredAt: now,
        },
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
      await enrichTicket(ticket.id, messageText);

      await postSlackReply(
        channel,
        ts,
        `Got it — ticket #${ticket.id.slice(0, 8)} created: "${ticket.extractedQuestion}"`
      );
    });
  }

  return new Response(null, { status: 200 });
}
