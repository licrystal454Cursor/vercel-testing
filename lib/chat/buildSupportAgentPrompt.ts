import type { PrefetchedNotionPage } from '../notionInstructionContext';
import type { AgentConfig, SupportTicket } from '../types';

export function buildSupportAgentPrompt(
  ticket: SupportTicket,
  agentConfig?: AgentConfig,
  stripeCustomerId?: string | null,
  prefetchedNotionPages?: PrefetchedNotionPage[],
): string {
  let docsSummary = '';
  let notionSummary = '';

  try {
    const docs = JSON.parse(ticket.publicDocsContent ?? '{}');
    docsSummary = docs.summary ?? '';
  } catch {
    // ignore malformed stored docs content
  }

  try {
    const notion = JSON.parse(ticket.notionContent ?? '{}');
    notionSummary = notion.summary ?? '';
  } catch {
    // ignore malformed stored notion content
  }

  const ticketContext = [
    '## Ticket Context',
    '',
    `Customer message: ${ticket.input.messageText}`,
    ticket.input.channelName ? `Slack channel: ${ticket.input.channelName}` : '',
    stripeCustomerId
      ? stripeCustomerId.startsWith('acct_')
        ? `Stripe account ID: ${stripeCustomerId} (API key is scoped to this account)`
        : `Stripe customer ID: ${stripeCustomerId}`
      : '',
    ticket.extractedQuestion ? `Extracted question: ${ticket.extractedQuestion}` : '',
    ticket.aiAnalysis ? `Pre-computed analysis: ${ticket.aiAnalysis}` : '',
    ticket.aiDraftReply ? `Draft reply: ${ticket.aiDraftReply}` : '',
    docsSummary ? `Public docs summary: ${docsSummary}` : '',
    notionSummary ? `Internal docs summary: ${notionSummary}` : '',
  ].filter(Boolean).join('\n');

  const isAccountId = stripeCustomerId?.startsWith('acct_');
  const stripeToolInstructions = stripeCustomerId
    ? isAccountId
      ? `- Stripe account tools: LIVE and connected to Stripe account ${stripeCustomerId}. The API key is already scoped to this account — do NOT pass "${stripeCustomerId}" as a customer parameter to any tool. Just call list_payment_intents, list_invoices, list_subscriptions, retrieve_balance, get_payment_method_configurations, etc. with no customer filter to get all account data. ALWAYS call these tools when asked — never say the connection is inactive.`
      : `- Stripe account tools: LIVE and connected. Use retrieve_customer("${stripeCustomerId}"), list_payment_intents, list_invoices, list_subscriptions, get_payment_method_configurations, etc. to query real account data. Pass customer="${stripeCustomerId}" when filtering by customer. ALWAYS call these tools when asked — never say the connection is inactive.`
    : '- Stripe account tools: available but no Stripe account is mapped to this channel yet.';

  const baseInstructions = `You are a Stripe support expert assisting a SUPPORT AGENT (the person you are chatting with now). The support agent is investigating a ticket on behalf of their customer.

CRITICAL ROLE CLARITY:
- The person chatting with you = the SUPPORT AGENT (internal staff)
- The Stripe account connected = belongs to the CUSTOMER they are supporting
- When the support agent says "how many coupons do I have" or "how much revenue have I generated", they mean the CUSTOMER'S account, not their own
- Never ask the support agent for the customer ID or account info — it is already provided below
- Never respond as if the support agent IS the customer
- In your replies, always refer to the account as "the customer's account" or "their account" — never "your account" or "your data"

${ticketContext}

---

IMPORTANT: You have live tool access. When asked for any information, call the appropriate tool immediately — do NOT say you lack access or ask for information already provided above.

Available tools:
- searchStripeDocs / extractStripePage: look up Stripe documentation
- searchNotionDocs: search the internal knowledge base by keyword
- getNotionPage: fetch a specific Notion page by its page ID
${stripeToolInstructions}

Respond conversationally to the support agent. Always call tools to fetch real data rather than guessing or refusing.`;

  const notionContext = prefetchedNotionPages && prefetchedNotionPages.length > 0
    ? `\n\n## Pre-loaded Customer Context (Notion)\n\n${prefetchedNotionPages
        .map(page => `### ${page.title}\n${page.url}\n\n${page.content}`)
        .join('\n\n---\n\n')}`
    : '';

  if (agentConfig?.instructions?.trim()) {
    return `# Agent Instructions\n\n${agentConfig.instructions}${notionContext}\n\n---\n\n${baseInstructions}`;
  }

  return baseInstructions + notionContext;
}
