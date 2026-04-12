import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { customProvider } from 'ai';

const gateway = createOpenAICompatible({
  name: 'vercel-ai-gateway',
  baseURL: 'https://ai-gateway.vercel.sh/v1',
  apiKey: process.env.AI_GATEWAY_KEY,
});

/**
 * Named model tiers for the enrichment agent.
 *
 * Use 'enrichment-fast' for routine research steps where speed and cost matter.
 * Use 'enrichment-reasoning' for tasks that require stronger instruction-following
 * or more nuanced synthesis (e.g. respecting customer-specific constraints from Notion).
 *
 * Use 'chat-default' for standard chat responses.
 */
export const agentProvider = customProvider({
  languageModels: {
    'enrichment-fast': gateway('openai/gpt-4.1-mini'),
    'enrichment-reasoning': gateway('openai/gpt-4.1'),
    'chat-default': gateway('openai/gpt-4.1-mini'),
  },
});

export type AgentModelId = 'enrichment-fast' | 'enrichment-reasoning';
export type ChatModelId = 'chat-default';
