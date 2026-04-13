import { parseNotionPageId } from '../notionTool';
import { prefetchInstructionNotionPages } from '../notionInstructionContext';
import { indexNotionPage, searchNotionChunks, formatChunksForPrompt } from '../notionRag';
import type { AgentConfig } from '../types';
import type { EnrichmentChannelContext } from './types';
import { BASE_SINGLE_AGENT_INSTRUCTIONS, NOTION_INSTRUCTIONS } from './prompts';

// Preloads and indexes any customer-specific Notion pages referenced by the
// selected agent instructions, then returns the prompt-ready retrieved context.
export async function buildInstructionNotionContext(
  messageText: string,
  instructions?: string,
): Promise<string> {
  const prefetchedNotionPages = await prefetchInstructionNotionPages(instructions);
  if (prefetchedNotionPages.length === 0) return '';

  await Promise.all(
    prefetchedNotionPages.map(page =>
      indexNotionPage({
        id: parseNotionPageId(page.url),
        title: page.title,
        url: page.url,
        content: page.content,
      })
    )
  );

  const chunks = await searchNotionChunks(messageText);
  return formatChunksForPrompt(chunks);
}

// Normalizes the top-level customer message into the shared prompt format used
// by both enrichment execution modes.
export function buildEnrichmentPrompt(
  messageText: string,
  channelContext?: EnrichmentChannelContext,
): string {
  return channelContext?.stripeCustomerId
    ? `Stripe Account ID (acct_...): ${channelContext.stripeCustomerId}\n\nCustomer message: "${messageText}"`
    : `Customer message: "${messageText}"`;
}

// Builds the Notion researcher instructions by appending any retrieved internal
// context after the selected agent's custom instructions.
export function buildNotionAgentInstructions(
  agentConfig: AgentConfig | undefined,
  notionContext: string,
): string {
  return agentConfig?.instructions?.trim()
    ? `# Agent Instructions\n\n${agentConfig.instructions}${notionContext}\n\n---\n\n${NOTION_INSTRUCTIONS}`
    : NOTION_INSTRUCTIONS;
}

// Builds the single-agent instructions, which combine customer-specific
// instructions with the legacy all-in-one research prompt.
export function buildSingleAgentInstructions(
  agentConfig: AgentConfig | undefined,
  notionContext: string,
): string {
  return agentConfig?.instructions?.trim()
    ? `# Agent Instructions\n\n${agentConfig.instructions}${notionContext}\n\n---\n\n${BASE_SINGLE_AGENT_INSTRUCTIONS}`
    : BASE_SINGLE_AGENT_INSTRUCTIONS;
}
