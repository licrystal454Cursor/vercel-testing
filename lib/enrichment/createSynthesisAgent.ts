import { ToolLoopAgent, stepCountIs, type ToolSet } from 'ai';
import { agentProvider, type AgentModelId } from '../provider';
import { consoleTelemetry } from '../telemetry';
import { SYNTHESIS_INSTRUCTIONS } from './prompts';

export function createSynthesisAgent({
  modelId,
  providerOptions,
  submitAnalysis,
}: {
  modelId: AgentModelId;
  providerOptions: { gateway: { models: string[] } };
  submitAnalysis: ToolSet[string];
}) {
  return new ToolLoopAgent({
    model: agentProvider.languageModel(modelId),
    providerOptions,
    instructions: SYNTHESIS_INSTRUCTIONS,
    tools: { submitAnalysis },
    toolChoice: { type: 'tool', toolName: 'submitAnalysis' },
    maxRetries: 5,
    stopWhen: stepCountIs(1),
    experimental_telemetry: { isEnabled: true, functionId: 'enrichTicket:synthesis', integrations: consoleTelemetry },
  });
}
