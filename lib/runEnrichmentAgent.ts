import { ToolLoopAgent, tool, stepCountIs, hasToolCall, type Tool } from 'ai';
import { createSearchTool, createExtractTool } from '@parallel-web/ai-sdk-tools';
import type { SearchResult, ExtractResponse } from 'parallel-web/resources/beta/beta.mjs';
import { createStripeAgentToolkit } from '@stripe/agent-toolkit/ai-sdk';
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

export interface EnrichmentOutput {
  diagnosis: string;
  draftReply: string;
  docsSummary: string;
  sources: { title: string; url: string }[];
  notionSummary: string;
  notionSources: { title: string; url: string }[];
  stripeFindings: string;
  /** True if the agent explicitly called submitAnalysis */
  submitAnalysisCalled: boolean;
  /** Raw step count for scoring */
  stepCount: number;
}

export interface EnrichmentAgentOptions {
  /** Replace specific tools — useful in evals to avoid real external calls. */
  toolOverrides?: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    searchNotionDocs?: Tool<{ query: string }, any>;
  };
  /** Override the model used by the agent — useful for comparing models in evals. */
  model?: AgentModelId;
}

export async function runEnrichmentAgent(
  messageText: string,
  agentConfig?: AgentConfig,
  channelContext?: { stripeCustomerId?: string; secretKey?: string },
  options?: EnrichmentAgentOptions,
): Promise<EnrichmentOutput> {
  let stripeTools: Record<string, unknown> = {};
  let stripeToolkit: Awaited<ReturnType<typeof createStripeAgentToolkit>> | null = null;
  const stripeKey = channelContext?.secretKey;
  if (stripeKey) {
    stripeToolkit = await createStripeAgentToolkit({
      secretKey: stripeKey,
      configuration: {},
    });
    stripeTools = stripeToolkit.getTools();
  }

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
        description:
          'Submit the completed analysis. Call this once you have gathered documentation and any relevant Stripe account data.',
        inputSchema: z.object({
          diagnosis: z.string().catch('').describe('Technical explanation of the root cause for the support agent'),
          draftReply: z.string().catch('').describe('Friendly, professional reply to send directly to the customer.'),
          docsSummary: z.string().catch('').describe('Concise 2-4 sentence summary of what the Stripe documentation says about this issue'),
          sources: z.array(z.object({
            title: z.string().catch('').describe('Title of the Stripe documentation page'),
            url: z.string().catch('').describe('Full URL of the Stripe documentation page'),
          })).catch([]).describe('All Stripe docs pages returned by your search'),
          notionSummary: z.string().nullable().catch('').describe('Concise 2-4 sentence summary of what the internal Notion documentation says. Empty string if nothing relevant was found.'),
          notionSources: z.array(z.object({
            title: z.string().catch('').describe('Title of the Notion page'),
            url: z.string().catch('').describe('URL of the Notion page'),
          })).nullable().catch([]).describe('All relevant Notion pages found'),
          stripeFindings: z.string().nullable().catch('').describe('Summary of any Stripe account data you looked up. Empty string if no IDs were provided.'),
        }),
      }),
    };

    // All tools except submitAnalysis — used to block premature submission on step 0
    const researchToolNames = Object.keys(tools).filter(k => k !== 'submitAnalysis') as Array<keyof typeof tools>;

    const agent = new ToolLoopAgent({
      model: agentProvider.languageModel(options?.model ?? 'enrichment-fast'),
      instructions,
      experimental_telemetry: {
        isEnabled: true,
        functionId: 'enrichTicket',
        integrations: consoleTelemetry,
      },
      tools,
      toolChoice: 'required',
      prepareStep: async ({ stepNumber }) => {
        // Block submitAnalysis on step 0 so research always happens first
        if (stepNumber === 0) {
          return { activeTools: researchToolNames };
        }
        return {};
      },
      stopWhen: [stepCountIs(20), hasToolCall('submitAnalysis')],
    });

    const prompt = channelContext?.stripeCustomerId
      ? `Customer Stripe ID: ${channelContext.stripeCustomerId}\n\nCustomer message: "${messageText}"`
      : `Customer message: "${messageText}"`;

    const result = await agent.generate({ prompt });

    // Collect discovered sources from tool results
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
            for (const r of output) {
              discoveredNotionSources.set(r.url, r.title);
            }
          }
        }
      }
    }

    let diagnosis = '';
    let draftReply = '';
    let docsSummary = '';
    let sources: { title: string; url: string }[] = [];
    let notionSummary = '';
    let notionSources: { title: string; url: string }[] = [];
    let stripeFindings = '';
    let submitAnalysisCalled = false;

    // submitAnalysis has no execute function, so it lands in staticToolCalls
    const submitCall = result.staticToolCalls.find(c => c.toolName === 'submitAnalysis');
    if (submitCall) {
      submitAnalysisCalled = true;
      const input = submitCall.input as {
        diagnosis: string;
        draftReply: string;
        docsSummary: string;
        sources: { title: string; url: string }[];
        notionSummary: string;
        notionSources: { title: string; url: string }[];
        stripeFindings: string;
      };
      diagnosis = input.diagnosis ?? '';
      draftReply = input.draftReply ?? '';
      docsSummary = input.docsSummary ?? '';
      sources = input.sources ?? [];
      notionSummary = input.notionSummary ?? '';
      notionSources = input.notionSources ?? [];
      stripeFindings = input.stripeFindings ?? '';
    }

    // Merge model-reported sources with every URL actually fetched
    const sourceUrls = new Set(sources.map(s => s.url));
    for (const [url, title] of discoveredSources) {
      if (!sourceUrls.has(url)) { sources.push({ url, title }); sourceUrls.add(url); }
    }
    const notionUrls = new Set(notionSources.map(s => s.url));
    for (const [url, title] of discoveredNotionSources) {
      if (!notionUrls.has(url)) { notionSources.push({ url, title }); notionUrls.add(url); }
    }

    if (!diagnosis) {
      diagnosis = result.text.trim() || 'Analysis unavailable.';
    }

    return {
      diagnosis,
      draftReply,
      docsSummary,
      sources,
      notionSummary,
      notionSources,
      stripeFindings,
      submitAnalysisCalled,
      stepCount: result.steps.length,
    };
  } finally {
    await stripeToolkit?.close();
  }
}
