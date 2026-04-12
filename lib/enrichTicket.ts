import { ticketStore } from './store';
import { runEnrichmentAgent, type EnrichmentAgentOptions } from './runEnrichmentAgent';
import type { AgentConfig } from './types';

export async function enrichTicket(
  ticketId: string,
  messageText: string,
  agentConfig?: AgentConfig,
  channelContext?: { stripeCustomerId?: string; secretKey?: string },
  options?: EnrichmentAgentOptions,
): Promise<void> {
  console.log('[enrichTicket] starting | custom instructions:', !!agentConfig?.instructions, '| stripe:', !!channelContext?.secretKey, '| multiAgent:', options?.multiAgent ?? true);

  const output = await runEnrichmentAgent(messageText, agentConfig, channelContext, options);

  console.log('[enrichTicket] done | submitAnalysisCalled:', output.submitAnalysisCalled, '| steps:', output.stepCount);

  await ticketStore.update(ticketId, {
    publicDocsContent: JSON.stringify({ summary: output.docsSummary, sources: output.sources }),
    notionContent: JSON.stringify({ summary: output.notionSummary, sources: output.notionSources }),
    replicationResult: output.stripeFindings,
    aiAnalysis: output.diagnosis,
    aiDraftReply: output.draftReply,
    updatedAt: new Date().toISOString(),
  });
}
