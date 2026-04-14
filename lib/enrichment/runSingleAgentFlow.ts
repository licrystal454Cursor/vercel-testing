import { ToolLoopAgent, hasToolCall, stepCountIs, type ToolSet } from 'ai';
import { agentProvider } from '../provider';
import { searchNotionDocs } from '../notionTool';
import { extractStripePage, searchStripeDocs } from '../stripeDocsTools';
import { consoleTelemetry } from '../telemetry';
import type { AgentConfig } from '../types';
import { buildEnrichmentPrompt, buildSingleAgentInstructions } from './buildContext';
import { parseSingleAgentResult } from './parseEnrichmentResults';
import { createSingleAgentSubmitAnalysisTool } from './reportTools';
import type { EnrichmentAgentOptions, EnrichmentChannelContext, EnrichmentOutput } from './types';

// Runs the legacy single-agent enrichment path that performs all research and
// synthesis in one loop instead of splitting work across specialized agents.
export async function runSingleAgentFlow({
  messageText,
  agentConfig,
  channelContext,
  options,
  notionContext,
  stripeTools,
  searchNotionDocsTool,
}: {
  messageText: string;
  agentConfig?: AgentConfig;
  channelContext?: EnrichmentChannelContext;
  options?: EnrichmentAgentOptions;
  notionContext: string;
  stripeTools: ToolSet;
  searchNotionDocsTool?: ToolSet[string];
}): Promise<EnrichmentOutput> {
  const tools = {
    searchStripeDocs,
    extractStripePage,
    searchNotionDocs: searchNotionDocsTool ?? options?.toolOverrides?.searchNotionDocs ?? searchNotionDocs,
    ...stripeTools,
    submitAnalysis: createSingleAgentSubmitAnalysisTool(),
  };

  const researchToolNames = Object.keys(tools).filter(toolName => toolName !== 'submitAnalysis') as Array<keyof typeof tools>;

  const agent = new ToolLoopAgent({
    model: agentProvider.languageModel(options?.model ?? 'enrichment-fast'),
    providerOptions: { gateway: { models: ['anthropic/claude-haiku-4.5', 'google/gemini-2.5-flash-lite'] } },
    maxRetries: 5,
    instructions: buildSingleAgentInstructions(agentConfig, notionContext),
    experimental_telemetry: { isEnabled: true, functionId: 'enrichTicket', integrations: consoleTelemetry },
    tools,
    toolChoice: 'required',
    prepareStep: async ({ stepNumber }) => {
      if (stepNumber === 0) return { activeTools: researchToolNames };
      return {};
    },
    stopWhen: [stepCountIs(20), hasToolCall('submitAnalysis')],
  });

  const result = await agent.generate({
    prompt: buildEnrichmentPrompt(messageText, channelContext),
  });

  return parseSingleAgentResult(result);
}
