import { createOpenAI } from '@ai-sdk/openai';
import { generateText } from 'ai';
import { ticketStore } from './store';

const gateway = createOpenAI({
  baseURL: 'https://ai-gateway.vercel.sh/v1',
  apiKey: process.env.AI_GATEWAY_KEY,
});

export async function enrichTicket(ticketId: string, messageText: string): Promise<void> {
  const { text: raw } = await generateText({
    model: gateway('openai/gpt-4.1-mini'),
    prompt: `You are a Stripe support expert helping a support agent respond to a customer issue.

Customer message: "${messageText}"

Respond with a JSON object containing exactly three fields:
- "diagnosis": A technical explanation of what is likely causing the issue, referencing specific Stripe concepts, APIs, or SDK behavior. Be specific and actionable.
- "draftReply": A friendly, professional reply to send directly to the customer. Acknowledge their issue, explain the likely cause, and provide clear next steps or a solution.
- "docsExcerpt": The most relevant content from the Stripe documentation for this issue. Include the specific API details, parameter explanations, code examples, or guidance that would help resolve it. Reference https://docs.stripe.com/ and include the specific page URL that is most relevant.

Respond with valid JSON only — no markdown, no code fences.`,
  });

  let diagnosis = raw.trim();
  let draftReply = '';
  let docsExcerpt = '';

  try {
    const cleaned = raw.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim();
    const parsed = JSON.parse(cleaned);
    diagnosis = parsed.diagnosis ?? diagnosis;
    draftReply = parsed.draftReply ?? '';
    docsExcerpt = parsed.docsExcerpt ?? '';
  } catch {
    // JSON parse failed — diagnosis holds the raw text, others stay empty
  }

  await ticketStore.update(ticketId, {
    publicDocsContent: docsExcerpt,
    aiAnalysis: diagnosis,
    aiDraftReply: draftReply,
    updatedAt: new Date().toISOString(),
  });
}
