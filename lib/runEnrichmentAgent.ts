import { ToolLoopAgent, tool, stepCountIs, hasToolCall, type Tool } from 'ai';
import { createSearchTool, createExtractTool } from '@parallel-web/ai-sdk-tools';
import type { ExtractResponse } from 'parallel-web/resources/beta/beta.mjs';
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

const STRIPE_DOCS_INSTRUCTIONS = `You are a Stripe documentation researcher. Search Stripe docs for information relevant to the customer's issue, extract the most relevant pages, then call reportStripeDocFindings with a summary of what you found and all source URLs.`;

const NOTION_INSTRUCTIONS = `You are an internal documentation researcher. Search internal Notion docs for policies, constraints, or customer-specific context relevant to the issue, then call reportNotionFindings with a summary.

## Important
If Notion results indicate the customer does NOT use a particular Stripe feature, include that explicitly in your summary — it is critical context for the final response.`;

const STRIPE_ACCOUNT_INSTRUCTIONS = `You are a Stripe account investigator. Read the customer's message carefully and use the Stripe API tools to investigate whatever is most relevant to their specific issue.

For example:
- If they mention a customer ID or payment method issue → fetch that customer's payment methods
- If they mention configuration problems → check payment method configurations
- If they mention a failed charge or error → look up recent events and failed API calls

Use your judgement to determine which tools to call based on what the customer is actually asking about. Call reportAccountFindings with a clear summary of what you found.`;

const SYNTHESIS_INSTRUCTIONS = `You are a Stripe support expert. You have been given research findings from parallel research agents. Synthesize these into a complete diagnosis and customer-ready reply, then call submitAnalysis.

## Notion context takes precedence
If internal Notion documentation indicates the customer does NOT use a particular Stripe feature, do NOT recommend that feature — even if it would otherwise be the standard recommendation.`;

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

  try {
    const modelId = options?.model ?? 'enrichment-fast';
    const fastProviderOptions = { gateway: { models: ['anthropic/claude-haiku-4.5'] } };
    const reasoningProviderOptions = { gateway: { models: ['anthropic/claude-sonnet-4.6'] } };

    const prompt = channelContext?.stripeCustomerId
      ? `Customer Stripe ID: ${channelContext.stripeCustomerId}\n\nCustomer message: "${messageText}"`
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
      stopWhen: [stepCountIs(5), hasToolCall('reportNotionFindings')],
      experimental_telemetry: { isEnabled: true, functionId: 'enrichTicket:notion', integrations: consoleTelemetry },
    });

    // ── Stripe account agent (only when secretKey is present) ─────────────

    const stripeApiTools = stripeToolkit?.getTools() ?? {};
    const stripeApiToolNames = Object.keys(stripeApiTools) as Array<keyof typeof stripeApiTools>;

    const stripeAccountAgent = stripeToolkit ? new ToolLoopAgent({
      model: agentProvider.languageModel(modelId),
      providerOptions: fastProviderOptions,
      instructions: STRIPE_ACCOUNT_INSTRUCTIONS,
      tools: { ...stripeApiTools, reportAccountFindings },
      toolChoice: 'required',
      prepareStep: async ({ stepNumber }) =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        stepNumber === 0 ? { activeTools: stripeApiToolNames as any[] } : {},
      stopWhen: [stepCountIs(5), hasToolCall('reportAccountFindings')],
      experimental_telemetry: { isEnabled: true, functionId: 'enrichTicket:stripe-account', integrations: consoleTelemetry },
    }) : null;

    // ── Run all research agents in parallel ───────────────────────────────

    const [stripeDocsResult, notionResult, accountResult] = await Promise.all([
      stripeDocsAgent.generate({ prompt }),
      notionAgent.generate({ prompt }),
      stripeAccountAgent?.generate({ prompt }) ?? Promise.resolve(null),
    ]);

    // Extract structured findings from each research agent's report tool
    const stripeDocsReport = stripeDocsResult.staticToolCalls.find(c => c.toolName === 'reportStripeDocFindings')?.input as
      { docsSummary: string; sources: { title: string; url: string }[] } | undefined;

    const notionReport = notionResult.staticToolCalls.find(c => c.toolName === 'reportNotionFindings')?.input as
      { notionSummary: string; notionSources: { title: string; url: string }[] } | undefined;

    const accountReport = accountResult?.staticToolCalls.find(c => c.toolName === 'reportAccountFindings')?.input as
      { stripeFindings: string } | undefined;

    // ── Synthesis agent ───────────────────────────────────────────────────

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
      model: agentProvider.languageModel('enrichment-reasoning'),
      providerOptions: reasoningProviderOptions,
      instructions: SYNTHESIS_INSTRUCTIONS,
      tools: { submitAnalysis },
      toolChoice: { type: 'tool', toolName: 'submitAnalysis' },
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
