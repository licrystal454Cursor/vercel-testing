import { ToolLoopAgent, hasToolCall, stepCountIs, type ToolSet } from 'ai';
import { agentProvider, type AgentModelId } from '../provider';
import { consoleTelemetry } from '../telemetry';
import { extractStripePage, searchStripeDocs } from '../stripeDocsTools';
import { STRIPE_DOCS_INSTRUCTIONS } from './prompts';

export function createStripeDocsAgent({
  modelId,
  providerOptions,
  reportStripeDocFindings,
}: {
  modelId: AgentModelId;
  providerOptions: { gateway: { models: string[] } };
  reportStripeDocFindings: ToolSet[string];
}) {
  return new ToolLoopAgent({
    model: agentProvider.languageModel(modelId),
    providerOptions,
    instructions: STRIPE_DOCS_INSTRUCTIONS,
    tools: { searchStripeDocs, extractStripePage, reportStripeDocFindings },
    toolChoice: 'required',
    prepareStep: async ({ stepNumber }) =>
      stepNumber === 0 ? { activeTools: ['searchStripeDocs', 'extractStripePage'] } : {},
    maxRetries: 5,
    stopWhen: [stepCountIs(5), hasToolCall('reportStripeDocFindings')],
    experimental_telemetry: { isEnabled: true, functionId: 'enrichTicket:stripe-docs', integrations: consoleTelemetry },
  });
}
