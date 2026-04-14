import { tool } from 'ai';
import { z } from 'zod';

export function createResearchReportTools() {
  const reportStripeDocFindings = tool({
    description: 'Report findings from Stripe documentation research',
    inputSchema: z.object({
      docsSummary: z.string().catch('').describe('Concise 2-4 sentence summary of what the Stripe documentation says about this issue'),
      sources: z.array(z.object({
        title: z.string().catch(''),
        url: z.string().catch(''),
      })).catch([]).describe('All Stripe docs pages found'),
    }),
  });

  const reportNotionFindings = tool({
    description: 'Report findings from internal Notion documentation',
    inputSchema: z.object({
      notionSummary: z.string().catch('').describe('Concise summary of what internal Notion docs say. Empty string if nothing relevant was found.'),
      notionSources: z.array(z.object({
        title: z.string().catch(''),
        url: z.string().catch(''),
      })).catch([]).describe('All relevant Notion pages found'),
      customerSpecificFindings: z.array(z.string().catch('')).catch([]).describe('Findings explicitly confirmed by customer-specific internal docs. Leave empty if the docs are only generic guidance.'),
      genericGuidance: z.array(z.string().catch('')).catch([]).describe('General internal guidance that may be relevant but does not prove this customer state.'),
    }),
  });

  const reportAccountFindings = tool({
    description: 'Report findings from investigating the customer Stripe account',
    inputSchema: z.object({
      stripeFindings: z.string().catch('').describe('Summary of what was found in the account: payment method state, recent errors, failed operations, etc.'),
      supportedConclusion: z.string().catch('').describe('The strongest conclusion directly supported by Stripe account evidence.'),
      accountEvidence: z.array(z.string().catch('')).catch([]).describe('Concrete facts directly observed from Stripe account tools.'),
      unsupportedHypotheses: z.array(z.string().catch('')).catch([]).describe('Plausible explanations that were not directly confirmed by Stripe account tools.'),
    }),
  });

  return {
    reportStripeDocFindings,
    reportNotionFindings,
    reportAccountFindings,
  };
}

export function createSynthesisSubmitAnalysisTool() {
  return tool({
    description: 'Submit the completed analysis once you have synthesized all research findings.',
    inputSchema: z.object({
      diagnosis: z.string().catch('').describe('Technical explanation of the root cause for the support agent'),
      draftReply: z.string().catch('').describe('Friendly, professional reply to send directly to the customer'),
    }),
  });
}

export function createSingleAgentSubmitAnalysisTool() {
  return tool({
    description: 'Submit the completed analysis. Call this once you have gathered documentation and any relevant Stripe account data.',
    inputSchema: z.object({
      diagnosis: z.string().catch('').describe('Technical explanation of the root cause for the support agent'),
      draftReply: z.string().catch('').describe('Friendly, professional reply to send directly to the customer.'),
      docsSummary: z.string().catch('').describe('Concise 2-4 sentence summary of what the Stripe documentation says about this issue'),
      sources: z.array(z.object({
        title: z.string().catch(''),
        url: z.string().catch(''),
      })).catch([]).describe('All Stripe docs pages returned by your search'),
      notionSummary: z.string().nullable().catch('').describe('Concise 2-4 sentence summary of internal Notion docs. Empty string if nothing relevant.'),
      notionSources: z.array(z.object({
        title: z.string().catch(''),
        url: z.string().catch(''),
      })).nullable().catch([]).describe('All relevant Notion pages found'),
      stripeFindings: z.string().nullable().catch('').describe('Summary of any Stripe account data looked up. Empty string if no IDs provided.'),
    }),
  });
}
