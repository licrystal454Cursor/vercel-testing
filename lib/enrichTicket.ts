import { createOpenAI } from '@ai-sdk/openai';
import { generateText } from 'ai';
import { ticketStore } from './store';

const gateway = createOpenAI({
  baseURL: 'https://ai-gateway.vercel.sh/v1',
  apiKey: process.env.AI_GATEWAY_KEY,
});

async function fetchStripeDocsContent(messageText: string): Promise<{ url: string; content: string }> {
  // Step 1: Ask AI which Stripe docs page is most relevant
  const { text: rawUrl } = await generateText({
    model: gateway('openai/gpt-4.1-mini'),
    prompt: `Given this Stripe support question: "${messageText}"
What is the single most relevant Stripe documentation URL to look up?
Only respond with the URL — no explanation, no markdown, just the URL starting with https://docs.stripe.com/`,
  });

  const url = rawUrl.trim();

  // Step 2: Fetch and extract text from that docs page
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; support-bot/1.0)' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { url, content: '' };

    const html = await res.text();
    const content = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 8000);

    return { url, content };
  } catch {
    return { url, content: '' };
  }
}

export async function enrichTicket(ticketId: string, messageText: string): Promise<void> {
  const { url, content } = await fetchStripeDocsContent(messageText);

  const docsSection = content
    ? `Relevant Stripe documentation from ${url}:\n${content}`
    : `Reference the Stripe documentation at https://docs.stripe.com/ for this issue.`;

  // Step 3: Generate diagnosis and draft reply in one call
  const { text: raw } = await generateText({
    model: gateway('openai/gpt-4.1-mini'),
    prompt: `You are a Stripe support expert helping a support agent respond to a customer issue.

Customer message: "${messageText}"

${docsSection}

Respond with a JSON object containing exactly two fields:
- "diagnosis": A technical explanation of what is likely causing the issue, referencing specific Stripe concepts, APIs, or SDK behavior. Be specific and actionable.
- "draftReply": A friendly, professional reply to send directly to the customer. Acknowledge their issue, explain the likely cause, and provide clear next steps or a solution.

Respond with valid JSON only — no markdown, no code fences.`,
  });

  let diagnosis = raw.trim();
  let draftReply = '';

  try {
    // Strip markdown code fences if the model included them
    const cleaned = raw.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim();
    const parsed = JSON.parse(cleaned);
    diagnosis = parsed.diagnosis ?? diagnosis;
    draftReply = parsed.draftReply ?? '';
  } catch {
    // If JSON parse fails, use the raw text as the diagnosis
  }

  await ticketStore.update(ticketId, {
    publicDocsContent: content ? `Source: ${url}\n\n${content}` : '',
    aiAnalysis: diagnosis,
    aiDraftReply: draftReply,
    updatedAt: new Date().toISOString(),
  });
}
