import { ToolLoopAgent, tool, stepCountIs, hasToolCall, type Tool } from 'ai';
import { createSearchTool, createExtractTool } from '@parallel-web/ai-sdk-tools';
import type { SearchResult, ExtractResponse } from 'parallel-web/resources/beta/beta.mjs';
import { createStripeAgentToolkit } from '@stripe/agent-toolkit/ai-sdk';
import Stripe from 'stripe';
import { z } from 'zod';
import { searchNotionDocs, fetchNotionPageById, parseNotionPageId } from './notionTool';
import { indexNotionPage, searchNotionChunks, formatChunksForPrompt } from './notionRag';
import { getCachedDoc, setCachedDoc } from './docsCache';
import { consoleTelemetry } from './telemetry';
import type { AgentConfig } from './types';
import { agentProvider, type AgentModelId } from './provider';

const searchStripeDocs = createSearchTool({
  source_policy: { include_domains: ['docs.stripe.com'] },
  mode: 'agentic',
  max_results: 5,
});

const rawExtractStripePage = createExtractTool({ full_content: true });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rawExecute = (rawExtractStripePage as any).execute as (...args: unknown[]) => Promise<ExtractResponse>;
const extractStripePage = {
  ...rawExtractStripePage,
  execute: async (...args: unknown[]) => {
    const input = args[0] as { urls: string[] };
    const url = input.urls?.[0];
    if (url) {
      const cached = await getCachedDoc(url);
      if (cached) return cached as ExtractResponse;
    }
    const result = await rawExecute(...args);
    if (url) {
      await setCachedDoc(url, result);
    }
    return result;
  },
};

const STRIPE_DOCS_INSTRUCTIONS = `You are a Stripe documentation researcher.

In your FIRST step, call searchStripeDocs with a query describing the customer's issue. Then immediately call reportStripeDocFindings with a summary of what you found and all source URLs. Only call extractStripePage if a specific page is critical to answer the question.`;

const NOTION_INSTRUCTIONS = `You are an internal documentation researcher.

In your FIRST step, call searchNotionDocs with a query describing the customer's issue. Then immediately call reportNotionFindings with a summary of what you found.

## Important
If Notion results indicate the customer does NOT use a particular Stripe feature, include that explicitly in your summary — it is critical context for the final response.`;

const STRIPE_ACCOUNT_INSTRUCTIONS = `You are a Stripe account investigator. Read the customer's message carefully and use the available Stripe API tools to investigate whatever is most relevant to their specific issue.

## ID types — read carefully before calling any tool
- Customer IDs start with "cus_" — use these with customer lookup tools
- Account IDs start with "acct_" — this is the merchant's own Stripe account ID, NOT a customer ID; never pass it to customer tools
- Payment method IDs start with "pm_"
- Charge IDs start with "ch_" or "py_"

## What to do based on the question type

**If the issue is about payment methods appearing unexpectedly or not appearing:**
→ Use get_stripe_account_info or the most relevant account tool to look up the account's payment method settings. Check which payment methods are enabled or disabled. Report exactly what you find and whether it explains the customer's issue.

**If a cus_ ID is mentioned:**
→ Fetch that specific customer's details or payment methods directly.

**If the issue is about a failed charge or error:**
→ Look up recent events or charges.

**If the prompt contains only an acct_ ID and no cus_ ID:**
→ Do NOT call list_customers or list_payment_intents. Use account-level tools to investigate the account configuration relevant to the question.

Call reportAccountFindings with a clear, specific summary of what you found and how it relates to the customer's issue.`;

const SYNTHESIS_INSTRUCTIONS = `You are a Stripe support expert. You have been given research findings from parallel research agents. Synthesize these into a complete diagnosis and customer-ready reply, then call submitAnalysis.

## Notion context takes precedence
If internal Notion documentation indicates the customer does NOT use a particular Stripe feature, do NOT recommend that feature — even if it would otherwise be the standard recommendation.

## Draft reply format
The reply will be sent as a Slack message, not an email. Keep it concise — 2-4 sentences max. No subject line, no sign-off, no "Hi [name]". Use plain conversational language. If steps are needed, use a short numbered list.
`;

export interface EnrichmentOutput {
  diagnosis: string;
  draftReply: string;
  docsSummary: string;
  sources: { title: string; url: string }[];
  notionSummary: string;
  notionSources: { title: string; url: string }[];
  stripeFindings: string;
  /** True if the synthesis agent explicitly called submitAnalysis */
  submitAnalysisCalled: boolean;
  /** Total step count across all agents */
  stepCount: number;
}

export interface EnrichmentAgentOptions {
  /** Replace specific tools — useful in evals to avoid real external calls. */
  toolOverrides?: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    searchNotionDocs?: Tool<{ query: string }, any>;
  };
  /** Override the model used by the research agents — useful for comparing models in evals. */
  model?: AgentModelId;
  /** Use the multi-agent pipeline (default: true). Set to false to use the original single-agent flow. */
  multiAgent?: boolean;
}

export async function runEnrichmentAgent(
  messageText: string,
  agentConfig?: AgentConfig,
  channelContext?: { stripeCustomerId?: string; secretKey?: string },
  options?: EnrichmentAgentOptions,
): Promise<EnrichmentOutput> {
  let stripeToolkit: Awaited<ReturnType<typeof createStripeAgentToolkit>> | null = null;
  const stripeKey = channelContext?.secretKey;
  if (stripeKey) {
    stripeToolkit = await createStripeAgentToolkit({
      secretKey: stripeKey,
      configuration: {},
    });
  }

  // Pre-fetch and index any Notion pages linked in agent instructions
  let notionContext = '';
  if (agentConfig?.instructions) {
    const notionUrlPattern = /https:\/\/(?:www\.)?notion\.so\/[^\s)]+/g;
    const urls = agentConfig.instructions.match(notionUrlPattern) ?? [];
    const pages = await Promise.all(urls.map(url => fetchNotionPageById(parseNotionPageId(url))));
    const fetched = pages.filter(Boolean) as { title: string; url: string; content: string }[];

    await Promise.all(
      fetched.map(p =>
        indexNotionPage({ id: parseNotionPageId(p.url), title: p.title, url: p.url, content: p.content })
      )
    );

    if (fetched.length > 0) {
      const chunks = await searchNotionChunks(messageText);
      notionContext = formatChunksForPrompt(chunks);
    }
  }

  const multiAgent = options?.multiAgent ?? true;

  if (!multiAgent) {
    return runSingleAgent(messageText, agentConfig, channelContext, options, notionContext);
  }

  try {
    const modelId = options?.model ?? 'enrichment-fast';
    const fastProviderOptions = { gateway: { models: ['anthropic/claude-haiku-4.5', 'google/gemini-2.5-flash-lite'] } };

    const prompt = channelContext?.stripeCustomerId
      ? `Stripe Account ID (acct_...): ${channelContext.stripeCustomerId}\n\nCustomer message: "${messageText}"`
      : `Customer message: "${messageText}"`;

    // ── Report tools (static — no execute function) ────────────────────────

    const reportStripeDocFindings = tool({
      description: 'Report findings from Stripe documentation research',
      inputSchema: z.object({
        docsSummary: z.string().catch('').describe('Concise 2-4 sentence summary of what the Stripe documentation says about this issue'),
        sources: z.array(z.object({
          title: z.string().catch(''),
          url: z.string().catch(''),
        })).catch([]).describe('All Stripe docs pages found'),
      }),
    });

    const reportNotionFindings = tool({
      description: 'Report findings from internal Notion documentation',
      inputSchema: z.object({
        notionSummary: z.string().catch('').describe('Concise summary of what internal Notion docs say. Empty string if nothing relevant was found.'),
        notionSources: z.array(z.object({
          title: z.string().catch(''),
          url: z.string().catch(''),
        })).catch([]).describe('All relevant Notion pages found'),
      }),
    });

    const reportAccountFindings = tool({
      description: 'Report findings from investigating the customer Stripe account',
      inputSchema: z.object({
        stripeFindings: z.string().catch('').describe('Summary of what was found in the account: payment method state, recent errors, failed operations, etc.'),
      }),
    });

    const submitAnalysis = tool({
      description: 'Submit the completed analysis once you have synthesized all research findings.',
      inputSchema: z.object({
        diagnosis: z.string().catch('').describe('Technical explanation of the root cause for the support agent'),
        draftReply: z.string().catch('').describe('Friendly, professional reply to send directly to the customer'),
      }),
    });

    // ── Stripe docs agent ─────────────────────────────────────────────────

    const stripeDocsAgent = new ToolLoopAgent({
      model: agentProvider.languageModel(modelId),
      providerOptions: fastProviderOptions,
      instructions: STRIPE_DOCS_INSTRUCTIONS,
      tools: { searchStripeDocs, extractStripePage, reportStripeDocFindings },
      toolChoice: 'required',
      prepareStep: async ({ stepNumber }) =>
        stepNumber === 0 ? { activeTools: ['searchStripeDocs', 'extractStripePage'] } : {},
      maxRetries: 5,
      stopWhen: [stepCountIs(5), hasToolCall('reportStripeDocFindings')],
      experimental_telemetry: { isEnabled: true, functionId: 'enrichTicket:stripe-docs', integrations: consoleTelemetry },
    });

    // ── Notion agent ──────────────────────────────────────────────────────

    const notionInstructions = agentConfig?.instructions?.trim()
      ? `# Agent Instructions\n\n${agentConfig.instructions}${notionContext}\n\n---\n\n${NOTION_INSTRUCTIONS}`
      : NOTION_INSTRUCTIONS;

    const notionAgent = new ToolLoopAgent({
      model: agentProvider.languageModel(modelId),
      providerOptions: fastProviderOptions,
      instructions: notionInstructions,
      tools: {
        searchNotionDocs: options?.toolOverrides?.searchNotionDocs ?? searchNotionDocs,
        reportNotionFindings,
      },
      toolChoice: 'required',
      prepareStep: async ({ stepNumber }) =>
        stepNumber === 0 ? { activeTools: ['searchNotionDocs'] } : {},
      maxRetries: 5,
      stopWhen: [stepCountIs(5), hasToolCall('reportNotionFindings')],
      experimental_telemetry: { isEnabled: true, functionId: 'enrichTicket:notion', integrations: consoleTelemetry },
    });

    // ── Stripe account agent (only when secretKey is present) ─────────────

    const allStripeApiTools = stripeToolkit?.getTools() ?? {};
    // Exclude documentation search — that's the stripe-docs agent's job
    const stripeApiTools = Object.fromEntries(
      Object.entries(allStripeApiTools).filter(([key]) => key !== 'search_stripe_documentation')
    );

    // Add a custom tool to query account-level payment method configurations
    // (not available via the Stripe MCP toolset)
    if (stripeKey) {
      const stripe = new Stripe(stripeKey);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (stripeApiTools as Record<string, any>)['get_payment_method_configurations'] = tool({
        description: 'List payment method configurations for the Stripe account and show exactly which payment methods (card, ACH/us_bank_account, Link, Apple Pay, SEPA, etc.) are enabled or disabled with their display preferences.',
        inputSchema: z.object({}),
        execute: async () => {
          const list = await stripe.paymentMethodConfigurations.list();
          return Promise.all(list.data.map(async summary => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const config = await stripe.paymentMethodConfigurations.retrieve(summary.id) as Record<string, any>;
            // Dynamically extract all payment method fields (they have an `available` property)
            const methods: Record<string, { available: boolean; preference: string }> = {};
            for (const [key, val] of Object.entries(config)) {
              if (val && typeof val === 'object' && 'available' in val) {
                methods[key] = {
                  available: val.available as boolean,
                  preference: val.display_preference?.value ?? 'unknown',
                };
              }
            }
            return {
              id: config.id as string,
              name: config.name as string,
              active: config.active as boolean,
              livemode: config.livemode as boolean,
              is_default: config.is_default as boolean,
              payment_methods: methods,
            };
          }));
        },
      });
    }

    const stripeApiToolNames = Object.keys(stripeApiTools) as Array<keyof typeof stripeApiTools>;

    const stripeAccountAgent = stripeToolkit ? new ToolLoopAgent({
      model: agentProvider.languageModel(modelId),
      providerOptions: fastProviderOptions,
      instructions: STRIPE_ACCOUNT_INSTRUCTIONS,
      tools: { ...stripeApiTools, reportAccountFindings },
      toolChoice: 'required',
      prepareStep: async ({ stepNumber }) => {
        if (stepNumber === 0) return { activeTools: stripeApiToolNames as any[] };
        if (stepNumber === 4) return { activeTools: ['reportAccountFindings'] }; // force report on last step
        return {};
      },
      maxRetries: 5,
      stopWhen: [stepCountIs(5), hasToolCall('reportAccountFindings')],
      experimental_telemetry: { isEnabled: true, functionId: 'enrichTicket:stripe-account', integrations: consoleTelemetry },
    }) : null;

    // ── Run research agents in parallel with staggered starts ─────────────
    // 500ms delay between each kick reduces burst rate while preserving overlap.

    const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

    const [stripeDocsResult, notionResult, accountResult] = await Promise.all([
      stripeDocsAgent.generate({ prompt }),
      delay(500).then(() => notionAgent.generate({ prompt })),
      stripeAccountAgent
        ? delay(1000).then(() => stripeAccountAgent.generate({ prompt }))
        : Promise.resolve(null),
    ]);

    // Extract structured findings from each research agent's report tool
    const stripeDocsReport = stripeDocsResult.staticToolCalls.find(c => c.toolName === 'reportStripeDocFindings')?.input as
      { docsSummary: string; sources: { title: string; url: string }[] } | undefined;

    const notionReport = notionResult.staticToolCalls.find(c => c.toolName === 'reportNotionFindings')?.input as
      { notionSummary: string; notionSources: { title: string; url: string }[] } | undefined;

    const accountReport = accountResult?.staticToolCalls.find(c => c.toolName === 'reportAccountFindings')?.input as
      { stripeFindings: string } | undefined;

    // ── Synthesis agent ───────────────────────────────────────────────────
    // Wait for the rate limit window to partially recover before the synthesis call.
    await delay(5000);

    const synthPrompt = [
      prompt,
      '',
      '## Stripe Documentation Findings',
      stripeDocsReport?.docsSummary ?? 'No documentation found.',
      '',
      '## Internal Notion Context',
      notionReport?.notionSummary ?? 'No internal documentation found.',
      ...(accountReport ? ['', '## Stripe Account Investigation', accountReport.stripeFindings] : []),
    ].join('\n');

    const synthesisAgent = new ToolLoopAgent({
      model: agentProvider.languageModel(modelId),
      providerOptions: fastProviderOptions,
      instructions: SYNTHESIS_INSTRUCTIONS,
      tools: { submitAnalysis },
      toolChoice: { type: 'tool', toolName: 'submitAnalysis' },
      maxRetries: 5,
      stopWhen: stepCountIs(1),
      experimental_telemetry: { isEnabled: true, functionId: 'enrichTicket:synthesis', integrations: consoleTelemetry },
    });

    const synthesisResult = await synthesisAgent.generate({ prompt: synthPrompt });

    const submitCall = synthesisResult.staticToolCalls.find(c => c.toolName === 'submitAnalysis')?.input as
      { diagnosis: string; draftReply: string } | undefined;

    return {
      diagnosis: submitCall?.diagnosis ?? (synthesisResult.text.trim() || 'Analysis unavailable.'),
      draftReply: submitCall?.draftReply ?? '',
      docsSummary: stripeDocsReport?.docsSummary ?? '',
      sources: stripeDocsReport?.sources ?? [],
      notionSummary: notionReport?.notionSummary ?? '',
      notionSources: notionReport?.notionSources ?? [],
      stripeFindings: accountReport?.stripeFindings ?? '',
      submitAnalysisCalled: !!submitCall,
      stepCount:
        stripeDocsResult.steps.length +
        notionResult.steps.length +
        (accountResult?.steps.length ?? 0) +
        synthesisResult.steps.length,
    };
  } finally {
    await stripeToolkit?.close();
  }
}

// ── Original single-agent implementation ─────────────────────────────────────

const BASE_INSTRUCTIONS = `You are a Stripe support expert helping support agents respond to customer issues.

## Notion context takes precedence

Internal Notion documentation represents customer-specific configuration and known constraints.
If Notion results indicate that the customer does NOT use a particular Stripe feature or product,
you MUST NOT recommend that feature in your reply — even if it would otherwise be the standard
Stripe recommendation. Notion context always takes precedence over general best practices.

## Research steps

In your FIRST step, call ALL of the following tools simultaneously (parallel tool calls):
- searchStripeDocs with a query describing the customer's issue
- searchNotionDocs with the same query
- Any relevant Stripe account tools if the customer message contains Stripe IDs (charge IDs, customer IDs, etc.)

Once you have results, call submitAnalysis. Include ALL pages from your searches in the sources arrays.`;

async function runSingleAgent(
  messageText: string,
  agentConfig: AgentConfig | undefined,
  channelContext: { stripeCustomerId?: string; secretKey?: string } | undefined,
  options: EnrichmentAgentOptions | undefined,
  notionContext: string,
): Promise<EnrichmentOutput> {
  let stripeTools: Record<string, unknown> = {};
  let stripeToolkit: Awaited<ReturnType<typeof createStripeAgentToolkit>> | null = null;
  const stripeKey = channelContext?.secretKey;
  if (stripeKey) {
    stripeToolkit = await createStripeAgentToolkit({ secretKey: stripeKey, configuration: {} });
    stripeTools = stripeToolkit.getTools();
  }

  const instructions = agentConfig?.instructions?.trim()
    ? `# Agent Instructions\n\n${agentConfig.instructions}${notionContext}\n\n---\n\n${BASE_INSTRUCTIONS}`
    : BASE_INSTRUCTIONS;

  try {
    const tools = {
      searchStripeDocs,
      extractStripePage,
      searchNotionDocs: options?.toolOverrides?.searchNotionDocs ?? searchNotionDocs,
      ...stripeTools,
      submitAnalysis: tool({
        description: 'Submit the completed analysis. Call this once you have gathered documentation and any relevant Stripe account data.',
        inputSchema: z.object({
          diagnosis: z.string().catch('').describe('Technical explanation of the root cause for the support agent'),
          draftReply: z.string().catch('').describe('Friendly, professional reply to send directly to the customer.'),
          docsSummary: z.string().catch('').describe('Concise 2-4 sentence summary of what the Stripe documentation says about this issue'),
          sources: z.array(z.object({
            title: z.string().catch(''),
            url: z.string().catch(''),
          })).catch([]).describe('All Stripe docs pages returned by your search'),
          notionSummary: z.string().nullable().catch('').describe('Concise 2-4 sentence summary of internal Notion docs. Empty string if nothing relevant.'),
          notionSources: z.array(z.object({
            title: z.string().catch(''),
            url: z.string().catch(''),
          })).nullable().catch([]).describe('All relevant Notion pages found'),
          stripeFindings: z.string().nullable().catch('').describe('Summary of any Stripe account data looked up. Empty string if no IDs provided.'),
        }),
      }),
    };

    const researchToolNames = Object.keys(tools).filter(k => k !== 'submitAnalysis') as Array<keyof typeof tools>;

    const agent = new ToolLoopAgent({
      model: agentProvider.languageModel(options?.model ?? 'enrichment-fast'),
      providerOptions: { gateway: { models: ['anthropic/claude-haiku-4.5', 'google/gemini-2.5-flash-lite'] } },
      maxRetries: 5,
      instructions,
      experimental_telemetry: { isEnabled: true, functionId: 'enrichTicket', integrations: consoleTelemetry },
      tools,
      toolChoice: 'required',
      prepareStep: async ({ stepNumber }) => {
        if (stepNumber === 0) return { activeTools: researchToolNames };
        return {};
      },
      stopWhen: [stepCountIs(20), hasToolCall('submitAnalysis')],
    });

    const prompt = channelContext?.stripeCustomerId
      ? `Stripe Account ID (acct_...): ${channelContext.stripeCustomerId}\n\nCustomer message: "${messageText}"`
      : `Customer message: "${messageText}"`;

    const result = await agent.generate({ prompt });

    const discoveredSources = new Map<string, string>();
    const discoveredNotionSources = new Map<string, string>();

    for (const step of result.steps) {
      for (const tr of step.toolResults ?? []) {
        if (!tr) continue;
        if (tr.toolName === 'searchStripeDocs') {
          for (const r of (tr.output as SearchResult).results) {
            discoveredSources.set(r.url, r.title ?? r.url);
          }
        } else if (tr.toolName === 'extractStripePage') {
          for (const r of (tr.output as ExtractResponse).results) {
            discoveredSources.set(r.url, r.title ?? r.url);
          }
        } else if (tr.toolName === 'searchNotionDocs') {
          const output = tr.output as { title: string; url: string; content: string }[] | string;
          if (Array.isArray(output)) {
            for (const r of output) discoveredNotionSources.set(r.url, r.title);
          }
        }
      }
    }

    let diagnosis = '', draftReply = '', docsSummary = '', notionSummary = '', stripeFindings = '';
    let sources: { title: string; url: string }[] = [];
    let notionSources: { title: string; url: string }[] = [];
    let submitAnalysisCalled = false;

    const submitCall = result.staticToolCalls.find(c => c.toolName === 'submitAnalysis');
    if (submitCall) {
      submitAnalysisCalled = true;
      const input = submitCall.input as {
        diagnosis: string; draftReply: string; docsSummary: string;
        sources: { title: string; url: string }[]; notionSummary: string;
        notionSources: { title: string; url: string }[]; stripeFindings: string;
      };
      diagnosis = input.diagnosis ?? '';
      draftReply = input.draftReply ?? '';
      docsSummary = input.docsSummary ?? '';
      sources = input.sources ?? [];
      notionSummary = input.notionSummary ?? '';
      notionSources = input.notionSources ?? [];
      stripeFindings = input.stripeFindings ?? '';
    }

    const sourceUrls = new Set(sources.map(s => s.url));
    for (const [url, title] of discoveredSources) {
      if (!sourceUrls.has(url)) { sources.push({ url, title }); sourceUrls.add(url); }
    }
    const notionUrls = new Set(notionSources.map(s => s.url));
    for (const [url, title] of discoveredNotionSources) {
      if (!notionUrls.has(url)) { notionSources.push({ url, title }); notionUrls.add(url); }
    }

    if (!diagnosis) diagnosis = result.text.trim() || 'Analysis unavailable.';

    return { diagnosis, draftReply, docsSummary, sources, notionSummary, notionSources, stripeFindings, submitAnalysisCalled, stepCount: result.steps.length };
  } finally {
    await stripeToolkit?.close();
  }
}
