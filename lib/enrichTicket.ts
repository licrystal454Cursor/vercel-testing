import { ticketStore } from './store';
import { runEnrichmentAgent } from './runEnrichmentAgent';
import type { AgentConfig } from './types';

export async function enrichTicket(
  ticketId: string,
  messageText: string,
  agentConfig?: AgentConfig,
  channelContext?: { stripeCustomerId?: string; secretKey?: string },
): Promise<void> {
  console.log('[enrichTicket] starting | custom instructions:', !!agentConfig?.instructions, '| stripe:', !!channelContext?.secretKey);

  const output = await runEnrichmentAgent(messageText, agentConfig, channelContext);

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
