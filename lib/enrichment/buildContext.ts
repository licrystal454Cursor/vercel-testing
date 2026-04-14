import { tool } from 'ai';
import { z } from 'zod';
import { parseNotionPageId, searchNotionDocsQuery, type NotionSearchResultPage } from '../notionTool';
import { prefetchInstructionNotionPages } from '../notionInstructionContext';
import { indexNotionPage, searchNotionChunks, formatChunksForPrompt } from '../notionRag';
import type { AgentConfig } from '../types';
import type { EnrichmentChannelContext } from './types';
import { BASE_SINGLE_AGENT_INSTRUCTIONS, NOTION_INSTRUCTIONS } from './prompts';

type InstructionNotionContext = {
  promptContext: string;
  prefetchedNotionPages: Array<{
    title: string;
    url: string;
    content: string;
  }>;
};

function dedupeNotionPages(pages: NotionSearchResultPage[]): NotionSearchResultPage[] {
  const seen = new Set<string>();
  return pages.filter(page => {
    if (seen.has(page.url)) return false;
    seen.add(page.url);
    return true;
  });
}

// Preloads and indexes any customer-specific Notion pages referenced by the
// selected agent instructions, then returns the prompt-ready retrieved context.
export async function buildInstructionNotionContext(
  messageText: string,
  instructions?: string,
): Promise<InstructionNotionContext> {
  const prefetchedNotionPages = await prefetchInstructionNotionPages(instructions);
  if (prefetchedNotionPages.length === 0) {
    return {
      promptContext: '',
      prefetchedNotionPages: [],
    };
  }

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

  const pageSections = await Promise.all(
    prefetchedNotionPages.map(async page => {
      const pageId = parseNotionPageId(page.url);
      const chunks = await searchNotionChunks(messageText, { pageId });
      const promptBody = chunks.length > 0
        ? formatChunksForPrompt(chunks)
        : page.content.slice(0, 2500);

      return `### ${page.title}\n${page.url}\n\n${promptBody}`;
    })
  );

  return {
    promptContext: `## Customer-Specific Internal Documentation (Highest Priority)

These pages were linked directly in the agent instructions for this customer.
Treat facts from this section as customer-specific evidence. Do not let broader
internal docs override an explicit fact from these pages.

${pageSections.join('\n\n---\n\n')}`,
    prefetchedNotionPages,
  };
}

export function createCustomerAwareNotionSearchTool(
  prefetchedNotionPages: NotionSearchResultPage[],
) {
  return tool({
    description:
      'Search internal Notion documentation. Customer-specific prefetched pages are always returned first when available, followed by broader internal docs.',
    inputSchema: z.object({
      query: z.string().describe('Search query to find relevant Notion pages'),
    }),
    execute: async ({ query }) => {
      const broaderResults = await searchNotionDocsQuery(query);
      if (typeof broaderResults === 'string') {
        return prefetchedNotionPages.length > 0 ? prefetchedNotionPages : broaderResults;
      }

      return dedupeNotionPages([
        ...prefetchedNotionPages,
        ...broaderResults,
      ]);
    },
  });
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
