import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { ToolLoopAgent, stepCountIs, createAgentUIStreamResponse, generateId, type UIMessage } from 'ai';
import { agentProvider } from '@/lib/provider';
import { createSearchTool, createExtractTool } from '@parallel-web/ai-sdk-tools';
import type { ExtractResponse } from 'parallel-web/resources/beta/beta.mjs';
import { createStripeAgentToolkit } from '@stripe/agent-toolkit/ai-sdk';
import { ticketStore } from '@/lib/store';
import { chatStore } from '@/lib/chatStore';
import { teamStore } from '@/lib/teamStore';
import { agentStore } from '@/lib/agentStore';
import { searchNotionDocs, getNotionPage, fetchNotionPageById, parseNotionPageId } from '@/lib/notionTool';
import { getCachedDoc, setCachedDoc } from '@/lib/docsCache';
import { consoleTelemetry } from '@/lib/telemetry';
import type { SupportTicket, AgentConfig } from '@/lib/types';

const gateway = createOpenAICompatible({
  name: 'vercel-ai-gateway',
  baseURL: 'https://ai-gateway.vercel.sh/v1',
  apiKey: process.env.AI_GATEWAY_KEY,
});

const searchStripeDocs = createSearchTool({
  source_policy: { include_domains: ['docs.stripe.com'] },
  mode: 'agentic',
  max_results: 5,
});

const rawExtractStripePage = createExtractTool({ full_content: true });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rawExtractExecute = (rawExtractStripePage as any).execute as (...args: unknown[]) => Promise<ExtractResponse>;
const extractStripePage = {
  ...rawExtractStripePage,
  execute: async (...args: unknown[]) => {
    const input = args[0] as { urls: string[] };
    const url = input.urls?.[0];
    if (url) {
      const cached = await getCachedDoc(url);
      if (cached) return cached as ExtractResponse;
    }
    const result = await rawExtractExecute(...args);
    if (url) {
      await setCachedDoc(url, result);
      console.log('[docs-cache] miss — stored |', url);
    }
    return result;
  },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function withToolLogging(name: string, tool: any): any {
  if (!tool?.execute) return tool;
  return {
    ...tool,
    execute: async (...args: unknown[]) => {
      const start = Date.now();
      console.log(`[tool:${name}] called | input:`, JSON.stringify(args).slice(0, 300));
      try {
        const result = await tool.execute(...args);
        console.log(`[tool:${name}] ok | ${Date.now() - start}ms | output:`, JSON.stringify(result).slice(0, 500));
        return result;
      } catch (err) {
        console.error(`[tool:${name}] ERROR | ${Date.now() - start}ms |`, String(err));
        throw err;
      }
    },
  };
}

function buildSystemPrompt(
  ticket: SupportTicket,
  agentConfig?: AgentConfig,
  stripeCustomerId?: string | null,
  prefetchedNotionPages?: { title: string; url: string; content: string }[]
): string {
  let docsSummary = '';
  let notionSummary = '';
  try {
    const docs = JSON.parse(ticket.publicDocsContent ?? '{}');
    docsSummary = docs.summary ?? '';
  } catch { /* ignore */ }
  try {
    const notion = JSON.parse(ticket.notionContent ?? '{}');
    notionSummary = notion.summary ?? '';
  } catch { /* ignore */ }

  const ticketContext = [
    `## Ticket Context`,
    ``,
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

  // Distinguish account IDs (acct_) from customer IDs (cus_) — they are used differently
  const isAccountId = stripeCustomerId?.startsWith('acct_');
  const stripeToolInstructions = stripeCustomerId
    ? isAccountId
      ? `- Stripe account tools: LIVE and connected to Stripe account ${stripeCustomerId}. The API key is already scoped to this account — do NOT pass "${stripeCustomerId}" as a customer parameter to any tool. Just call list_payment_intents, list_invoices, list_subscriptions, retrieve_balance, etc. with no customer filter to get all account data. ALWAYS call these tools when asked — never say the connection is inactive.`
      : `- Stripe account tools: LIVE and connected. Use retrieve_customer("${stripeCustomerId}"), list_payment_intents, list_invoices, list_subscriptions, etc. to query real account data. Pass customer="${stripeCustomerId}" when filtering by customer. ALWAYS call these tools when asked — never say the connection is inactive.`
    : `- Stripe account tools: available but no Stripe account is mapped to this channel yet.`;

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

  const notionContext =
    prefetchedNotionPages && prefetchedNotionPages.length > 0
      ? `\n\n## Pre-loaded Customer Context (Notion)\n\n` +
        prefetchedNotionPages
          .map(p => `### ${p.title}\n${p.url}\n\n${p.content}`)
          .join('\n\n---\n\n')
      : '';

  if (agentConfig?.instructions?.trim()) {
    return `# Agent Instructions\n\n${agentConfig.instructions}${notionContext}\n\n---\n\n${baseInstructions}`;
  }

  return baseInstructions + notionContext;
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const body = await req.json() as { message: UIMessage; id: string };
  const newMessage: UIMessage = body.message;

  // Save the incoming user message immediately
  const userTextPart = (newMessage.parts ?? []).find(
    (p): p is { type: 'text'; text: string } => p.type === 'text'
  );
  const userText = userTextPart?.text ?? '';
  if (userText) await chatStore.save(id, newMessage.id, 'user', userText);

  // Load authoritative conversation history from DB and append the new message
  const dbMessages = await chatStore.list(id);
  const uiMessages: UIMessage[] = [
    ...dbMessages
      .filter(m => m.id !== newMessage.id) // avoid duplicate if save already added it
      .map(m => ({
        id: m.id,
        role: m.role as 'user' | 'assistant',
        parts: [{ type: 'text' as const, text: m.content }],
      })),
    newMessage,
  ];

  const ticket = await ticketStore.get(id);
  if (!ticket) return Response.json({ error: 'Not found' }, { status: 404 });

  // Look up channel agent config
  let agentConfig: AgentConfig | undefined;
  const channelId = ticket.input.channelId;
  if (channelId) {
    const agentId = await teamStore.getAgentForChannel(channelId);
    if (agentId) {
      const agents = await agentStore.list();
      agentConfig = agents.find(a => a.id === agentId);
    }
  }

  // Pre-fetch any Notion pages referenced in the agent instructions
  const prefetchedNotionPages: { title: string; url: string; content: string }[] = [];
  if (agentConfig?.instructions) {
    const notionUrlPattern = /https:\/\/(?:www\.)?notion\.so\/[^\s)]+/g;
    const urls = agentConfig.instructions.match(notionUrlPattern) ?? [];
    const results = await Promise.all(urls.map(url => fetchNotionPageById(parseNotionPageId(url))));
    for (const result of results) {
      if (result) prefetchedNotionPages.push(result);
    }
  }

  // Look up Stripe customer ID and per-channel secret key from channel mapping
  const msgCustomerId = ticket.input.messageText.match(/cus_[a-zA-Z0-9]+/)?.[0];
  const [stripeCustomerId, channelSecretKey] = await Promise.all([
    msgCustomerId
      ? Promise.resolve(msgCustomerId)
      : teamStore.getStripeCustomerForChannel(ticket.input.channelId),
    teamStore.getSecretKeyForChannel(ticket.input.channelId),
  ]);

  const stripeSecretKey = channelSecretKey;

  let stripeTools: Record<string, unknown> = {};
  let stripeToolkit: Awaited<ReturnType<typeof createStripeAgentToolkit>> | null = null;
  if (stripeSecretKey) {
    stripeToolkit = await createStripeAgentToolkit({
      secretKey: stripeSecretKey,
      configuration: {},
    });
    console.log('[stripe] toolkit initialized, tools available:', Object.keys(stripeToolkit.getTools()).length);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rawTools = stripeToolkit.getTools() as Record<string, any>;
    stripeTools = Object.fromEntries(
      Object.entries(rawTools).map(([name, t]) => [name, withToolLogging(name, t)])
    );
  }

  const toolSet = {
    searchStripeDocs: withToolLogging('searchStripeDocs', searchStripeDocs),
    extractStripePage: withToolLogging('extractStripePage', extractStripePage),
    searchNotionDocs: withToolLogging('searchNotionDocs', searchNotionDocs),
    getNotionPage: withToolLogging('getNotionPage', getNotionPage),
    ...stripeTools,
  };

  console.log('[chat] ticket:', id, '| stripeCustomerId:', stripeCustomerId, '| keySource:', channelSecretKey ? 'channel' : 'env', '| tools:', Object.keys(toolSet), '| agentConfig:', agentConfig?.name ?? 'default');

  const agent = new ToolLoopAgent({
    model: agentProvider.languageModel('chat-default'),
    instructions: buildSystemPrompt(ticket, agentConfig, stripeCustomerId, prefetchedNotionPages),
    tools: toolSet,
    stopWhen: stepCountIs(10),
    experimental_telemetry: {
      isEnabled: true,
      functionId: 'chat',
      metadata: { ticketId: id, channelId: ticket.input.channelId ?? 'unknown' },
      integrations: consoleTelemetry,
    },
  });

  return await createAgentUIStreamResponse({
      agent,
      uiMessages,
      // Drain a copy of the stream server-side so onFinish fires even if the client disconnects
      consumeSseStream: ({ stream }: { stream: ReadableStream }) => {
        const reader = stream.getReader();
        const drain = (): void => { reader.read().then(({ done }) => { if (!done) drain(); }); };
        drain();
      },
      onStepFinish: (step) => {
        const toolCalls = step.content
          .filter(p => p.type === 'tool-call')
          .map(p => p.toolName);
        console.log('[chat] step', step.stepNumber, '| text length:', step.text.length, '| tool calls:', toolCalls);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const s = step as any;
        console.log('[chat] step keys:', Object.keys(s));
        const results = s.toolResults ?? s.tool_results ?? s.results;
        if (Array.isArray(results) && results.length > 0) {
          for (const r of results) {
            console.log('[chat] tool result:', r.toolName, '|', JSON.stringify(r.output ?? r.result ?? r).slice(0, 500));
          }
        }
        // Also check content for tool-result parts
        const resultParts = (s.content ?? []).filter((p: any) => p.type === 'tool-result');
        for (const p of resultParts) {
          console.log('[chat] content tool-result:', p.toolName, '|', JSON.stringify(p.output ?? p.result).slice(0, 500));
        }
      },
      onFinish: async ({ responseMessage, isAborted }) => {
        // Close the MCP connection here — after the stream ends, not in finally.
        // The finally block runs when the Response is returned (stream start),
        // which is before the agent finishes making tool calls.
        await stripeToolkit?.close();

        console.log('[chat] onFinish |', {
          isAborted,
          hasResponseMessage: !!responseMessage,
          responseMessageId: responseMessage?.id,
          parts: responseMessage?.parts?.map(p => p.type),
        });

        if (!isAborted) {
          const textPart = (responseMessage.parts ?? []).find(
            (p): p is { type: 'text'; text: string } => p.type === 'text'
          );
          const text = textPart?.text ?? '';
          const msgId = responseMessage.id || generateId();
          console.log('[chat] finish | text length:', text.length, '| msgId:', msgId);
          if (text) await chatStore.save(id, msgId, 'assistant', text);
        }
      },
  });
}
