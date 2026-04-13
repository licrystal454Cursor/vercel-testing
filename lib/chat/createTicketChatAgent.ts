import { ToolLoopAgent, stepCountIs, type ToolSet } from 'ai';
import { getNotionPage, searchNotionDocs } from '../notionTool';
import { agentProvider } from '../provider';
import { extractStripePage, searchStripeDocs } from '../stripeDocsTools';
import { buildStripeToolContext, withToolLogging } from '../stripeToolkitTools';
import { consoleTelemetry } from '../telemetry';
import type { AgentConfig, SupportTicket } from '../types';
import type { PrefetchedNotionPage } from '../notionInstructionContext';
import { buildSupportAgentPrompt } from './buildSupportAgentPrompt';

// Builds the interactive ticket-chat agent with the same shared tools used by
// enrichment, plus route-specific logging wrappers for operator visibility.
export async function createTicketChatAgent({
  ticketId,
  ticket,
  agentConfig,
  prefetchedNotionPages,
  stripeCustomerId,
  channelSecretKey,
}: {
  ticketId: string;
  ticket: SupportTicket;
  agentConfig?: AgentConfig;
  prefetchedNotionPages: PrefetchedNotionPage[];
  stripeCustomerId: string | null;
  channelSecretKey: string | null;
}) {
  let stripeTools: ToolSet = {};
  let stripeToolkit: Awaited<ReturnType<typeof buildStripeToolContext>>['toolkit'] | null = null;

  if (channelSecretKey) {
    const stripeToolContext = await buildStripeToolContext({
      secretKey: channelSecretKey,
      wrapTool: withToolLogging,
    });
    stripeToolkit = stripeToolContext.toolkit;
    stripeTools = stripeToolContext.tools;
    console.log('[stripe] toolkit initialized, tools available:', stripeToolContext.toolNames.length);
  }

  const tools = {
    searchStripeDocs: withToolLogging('searchStripeDocs', searchStripeDocs),
    extractStripePage: withToolLogging('extractStripePage', extractStripePage),
    searchNotionDocs: withToolLogging('searchNotionDocs', searchNotionDocs),
    getNotionPage: withToolLogging('getNotionPage', getNotionPage),
    ...stripeTools,
  };

  console.log(
    '[chat] ticket:',
    ticketId,
    '| stripeCustomerId:',
    stripeCustomerId,
    '| keySource:',
    channelSecretKey ? 'channel' : 'env',
    '| tools:',
    Object.keys(tools),
    '| agentConfig:',
    agentConfig?.name ?? 'default',
  );

  const agent = new ToolLoopAgent({
    model: agentProvider.languageModel('chat-default'),
    providerOptions: {
      gateway: {
        models: ['anthropic/claude-haiku-4.5', 'google/gemini-2.5-flash-lite'],
      },
    },
    maxRetries: 5,
    instructions: buildSupportAgentPrompt(
      ticket,
      agentConfig,
      stripeCustomerId,
      prefetchedNotionPages,
    ),
    tools,
    stopWhen: stepCountIs(10),
    prepareStep: async ({ stepNumber }) => {
      if (stepNumber === 9) return { toolChoice: 'none' };
      return {};
    },
    experimental_telemetry: {
      isEnabled: true,
      functionId: 'chat',
      metadata: { ticketId, channelId: ticket.input.channelId ?? 'unknown' },
      integrations: consoleTelemetry,
    },
  });

  return {
    agent,
    stripeToolkit,
  };
}
