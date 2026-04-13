import type { Tool } from 'ai';
import type { AgentModelId } from '../provider';

export interface EnrichmentOutput {
  diagnosis: string;
  draftReply: string;
  docsSummary: string;
  sources: { title: string; url: string }[];
  notionSummary: string;
  notionSources: { title: string; url: string }[];
  stripeFindings: string;
  submitAnalysisCalled: boolean;
  stepCount: number;
}

export interface EnrichmentAgentOptions {
  toolOverrides?: {
    searchNotionDocs?: Tool<{ query: string }, unknown>;
  };
  model?: AgentModelId;
  multiAgent?: boolean;
}

export interface EnrichmentChannelContext {
  stripeCustomerId?: string;
  secretKey?: string;
}

export interface StripeDocsReport {
  docsSummary: string;
  sources: { title: string; url: string }[];
}

export interface NotionReport {
  notionSummary: string;
  notionSources: { title: string; url: string }[];
}

export interface AccountReport {
  stripeFindings: string;
}
