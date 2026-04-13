import { ToolLoopAgent, hasToolCall, stepCountIs, type ToolSet } from 'ai';
import { agentProvider, type AgentModelId } from '../provider';
import { consoleTelemetry } from '../telemetry';
import { STRIPE_ACCOUNT_INSTRUCTIONS } from './prompts';

export function createStripeAccountAgent({
  modelId,
  providerOptions,
  stripeTools,
  reportAccountFindings,
}: {
  modelId: AgentModelId;
  providerOptions: { gateway: { models: string[] } };
  stripeTools: ToolSet;
  reportAccountFindings: ToolSet[string];
}) {
  const tools = {
    ...stripeTools,
    reportAccountFindings,
  };

  const researchToolNames = Object.keys(tools).filter(
    (toolName): toolName is Exclude<keyof typeof tools, 'reportAccountFindings'> =>
      toolName !== 'reportAccountFindings',
  );

  return new ToolLoopAgent({
    model: agentProvider.languageModel(modelId),
    providerOptions,
    instructions: STRIPE_ACCOUNT_INSTRUCTIONS,
    tools,
    toolChoice: 'required',
    prepareStep: async ({ stepNumber }) => {
      if (stepNumber === 0) return { activeTools: researchToolNames };
      if (stepNumber === 4) return { activeTools: ['reportAccountFindings'] as const };
      return {};
    },
    maxRetries: 5,
    stopWhen: [stepCountIs(5), hasToolCall('reportAccountFindings')],
    experimental_telemetry: { isEnabled: true, functionId: 'enrichTicket:stripe-account', integrations: consoleTelemetry },
  });
}
