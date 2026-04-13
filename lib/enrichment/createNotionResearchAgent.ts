import { ToolLoopAgent, hasToolCall, stepCountIs, type ToolSet } from 'ai';
import { agentProvider, type AgentModelId } from '../provider';
import { searchNotionDocs } from '../notionTool';
import { consoleTelemetry } from '../telemetry';

export function createNotionResearchAgent({
  modelId,
  providerOptions,
  instructions,
  reportNotionFindings,
  overriddenSearchNotionDocs,
}: {
  modelId: AgentModelId;
  providerOptions: { gateway: { models: string[] } };
  instructions: string;
  reportNotionFindings: ToolSet[string];
  overriddenSearchNotionDocs?: ToolSet[string];
}) {
  return new ToolLoopAgent({
    model: agentProvider.languageModel(modelId),
    providerOptions,
    instructions,
    tools: {
      searchNotionDocs: overriddenSearchNotionDocs ?? searchNotionDocs,
      reportNotionFindings,
    },
    toolChoice: 'required',
    prepareStep: async ({ stepNumber }) =>
      stepNumber === 0 ? { activeTools: ['searchNotionDocs'] } : {},
    maxRetries: 5,
    stopWhen: [stepCountIs(5), hasToolCall('reportNotionFindings')],
    experimental_telemetry: { isEnabled: true, functionId: 'enrichTicket:notion', integrations: consoleTelemetry },
  });
}
