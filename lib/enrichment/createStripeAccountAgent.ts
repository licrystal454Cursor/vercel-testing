import { ToolLoopAgent, hasToolCall, stepCountIs, type ToolSet } from 'ai';
import { agentProvider, type AgentModelId } from '../provider';
import { consoleTelemetry } from '../telemetry';
import { STRIPE_ACCOUNT_INSTRUCTIONS } from './prompts';

export function createStripeAccountAgent({
  modelId,
  providerOptions,
  stripeTools,
  stripeToolNames,
  reportAccountFindings,
}: {
  modelId: AgentModelId;
  providerOptions: { gateway: { models: string[] } };
  stripeTools: ToolSet;
  stripeToolNames: string[];
  reportAccountFindings: ToolSet[string];
}) {
  return new ToolLoopAgent({
    model: agentProvider.languageModel(modelId),
    providerOptions,
    instructions: STRIPE_ACCOUNT_INSTRUCTIONS,
    tools: {
      ...stripeTools,
      reportAccountFindings,
    },
    toolChoice: 'required',
    prepareStep: async ({ stepNumber }) => {
      if (stepNumber === 0) return { activeTools: stripeToolNames };
      if (stepNumber === 4) return { activeTools: ['reportAccountFindings'] };
      return {};
    },
    maxRetries: 5,
    stopWhen: [stepCountIs(5), hasToolCall('reportAccountFindings')],
    experimental_telemetry: { isEnabled: true, functionId: 'enrichTicket:stripe-account', integrations: consoleTelemetry },
  });
}
