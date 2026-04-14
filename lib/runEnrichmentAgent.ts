import {
  buildEnrichmentPrompt,
  buildInstructionNotionContext,
  buildNotionAgentInstructions,
  createCustomerAwareNotionSearchTool,
} from './enrichment/buildContext';
import { createNotionResearchAgent } from './enrichment/createNotionResearchAgent';
import { createStripeAccountAgent } from './enrichment/createStripeAccountAgent';
import { createStripeDocsAgent } from './enrichment/createStripeDocsAgent';
import { createSynthesisAgent } from './enrichment/createSynthesisAgent';
import { buildMultiAgentOutput, buildSynthesisPrompt, extractResearchReports } from './enrichment/parseEnrichmentResults';
import { createResearchReportTools, createSynthesisSubmitAnalysisTool } from './enrichment/reportTools';
import { runSingleAgentFlow } from './enrichment/runSingleAgentFlow';
import type { EnrichmentAgentOptions, EnrichmentChannelContext, EnrichmentOutput } from './enrichment/types';
import { buildStripeToolContext } from './stripeToolkitTools';
import type { AgentConfig } from './types';

export type { EnrichmentAgentOptions, EnrichmentOutput } from './enrichment/types';

// Coordinates the full ticket-enrichment flow:
// 1) build shared context and tools,
// 2) run either the single-agent fallback or the multi-agent research pipeline,
// 3) normalize the final output shape for callers.
export async function runEnrichmentAgent(
  messageText: string,
  agentConfig?: AgentConfig,
  channelContext?: EnrichmentChannelContext,
  options?: EnrichmentAgentOptions,
): Promise<EnrichmentOutput> {
  // Stripe toolkit setup is optional because some channels do not have a
  // customer-specific API key mapped yet.
  let stripeToolkit: Awaited<ReturnType<typeof buildStripeToolContext>>['toolkit'] | null = null;
  let stripeTools = {};

  if (channelContext?.secretKey) {
    const stripeToolContext = await buildStripeToolContext({
      secretKey: channelContext.secretKey,
      excludeDocumentationSearch: true,
    });
    stripeToolkit = stripeToolContext.toolkit;
    stripeTools = stripeToolContext.tools;
  }

  // Internal Notion context is pre-indexed up front so both the single-agent
  // and multi-agent flows can consume the same retrieved customer context.
  const {
    promptContext: notionContext,
    prefetchedNotionPages,
  } = await buildInstructionNotionContext(messageText, agentConfig?.instructions);
  const searchNotionDocsTool = options?.toolOverrides?.searchNotionDocs
    ?? (prefetchedNotionPages.length > 0
      ? createCustomerAwareNotionSearchTool(prefetchedNotionPages)
      : undefined);
  const multiAgent = options?.multiAgent ?? true;

  // Preserve the original single-agent path for evals and lower-complexity runs.
  if (!multiAgent) {
    return runSingleAgentFlow({
      messageText,
      agentConfig,
      channelContext,
      options,
      notionContext,
      stripeTools,
      searchNotionDocsTool,
    });
  }

  try {
    const modelId = options?.model ?? 'enrichment-fast';
    const providerOptions = {
      gateway: { models: ['anthropic/claude-haiku-4.5', 'google/gemini-2.5-flash-lite'] },
    };
    const prompt = buildEnrichmentPrompt(messageText, channelContext);
    const { reportStripeDocFindings, reportNotionFindings, reportAccountFindings } = createResearchReportTools();
    const submitAnalysis = createSynthesisSubmitAnalysisTool();

    // Create specialized agents instead of one large generalist agent so docs,
    // internal context, and account investigation can run independently.
    const stripeDocsAgent = createStripeDocsAgent({
      modelId,
      providerOptions,
      reportStripeDocFindings,
    });

    const notionAgent = createNotionResearchAgent({
      modelId,
      providerOptions,
      instructions: buildNotionAgentInstructions(agentConfig, notionContext),
      reportNotionFindings,
      overriddenSearchNotionDocs: searchNotionDocsTool,
    });

    const stripeAccountAgent = stripeToolkit
      ? createStripeAccountAgent({
          modelId,
          providerOptions,
          stripeTools,
          reportAccountFindings,
        })
      : null;

    // Staggered starts reduce burst pressure while still keeping the research
    // work overlapped in time.
    const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

    const [stripeDocsResult, notionResult, accountResult] = await Promise.all([
      stripeDocsAgent.generate({ prompt }),
      delay(500).then(() => notionAgent.generate({ prompt })),
      stripeAccountAgent
        ? delay(1000).then(() => stripeAccountAgent.generate({ prompt }))
        : Promise.resolve(null),
    ]);

    const researchReports = extractResearchReports({
      stripeDocsResult,
      notionResult,
      accountResult,
    });

    // The synthesis step intentionally waits for a brief cooldown before making
    // the final model call, then turns all research into the stable output contract.
    await delay(5000);

    const synthesisAgent = createSynthesisAgent({
      modelId,
      providerOptions,
      submitAnalysis,
    });

    const synthesisResult = await synthesisAgent.generate({
      prompt: buildSynthesisPrompt({
        prompt,
        ...researchReports,
      }),
    });

    return buildMultiAgentOutput({
      stripeDocsResult,
      notionResult,
      accountResult,
      synthesisResult,
    });
  } finally {
    await stripeToolkit?.close();
  }
}
