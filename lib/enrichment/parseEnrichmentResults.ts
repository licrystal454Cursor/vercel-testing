import type { ExtractResponse, SearchResult } from 'parallel-web/resources/beta/beta.mjs';
import type { AccountReport, EnrichmentOutput, NotionReport, StripeDocsReport } from './types';

type StaticToolCallResult = {
  toolName: string;
  input: unknown;
};

type ToolResult = {
  toolName: string;
  output: unknown;
};

type AgentResultShape = {
  text: string;
  steps: Array<{ toolResults?: ToolResult[] }>;
  staticToolCalls: StaticToolCallResult[];
};

// Pulls the structured outputs from the specialized research agents so the
// synthesis step does not need to know about raw tool-call shapes.
export function extractResearchReports({
  stripeDocsResult,
  notionResult,
  accountResult,
}: {
  stripeDocsResult: AgentResultShape;
  notionResult: AgentResultShape;
  accountResult: AgentResultShape | null;
}): {
  stripeDocsReport?: StripeDocsReport;
  notionReport?: NotionReport;
  accountReport?: AccountReport;
} {
  const stripeDocsReport = stripeDocsResult.staticToolCalls.find(
    call => call.toolName === 'reportStripeDocFindings',
  )?.input as StripeDocsReport | undefined;

  const notionReport = notionResult.staticToolCalls.find(
    call => call.toolName === 'reportNotionFindings',
  )?.input as NotionReport | undefined;

  const accountReport = accountResult?.staticToolCalls.find(
    call => call.toolName === 'reportAccountFindings',
  )?.input as AccountReport | undefined;

  return {
    stripeDocsReport,
    notionReport,
    accountReport,
  };
}

// Builds the final synthesis prompt from the original ticket plus the outputs
// of the docs, internal-context, and account-investigation agents.
export function buildSynthesisPrompt({
  prompt,
  stripeDocsReport,
  notionReport,
  accountReport,
}: {
  prompt: string;
  stripeDocsReport?: StripeDocsReport;
  notionReport?: NotionReport;
  accountReport?: AccountReport;
}): string {
  const accountEvidence = accountReport?.accountEvidence?.length
    ? accountReport.accountEvidence.map(item => `- ${item}`).join('\n')
    : 'No direct account evidence provided.';
  const unsupportedHypotheses = accountReport?.unsupportedHypotheses?.length
    ? accountReport.unsupportedHypotheses.map(item => `- ${item}`).join('\n')
    : 'None.';
  const notionCustomerSpecificFindings = notionReport?.customerSpecificFindings?.length
    ? notionReport.customerSpecificFindings.map(item => `- ${item}`).join('\n')
    : 'No customer-specific Notion facts confirmed.';
  const notionGenericGuidance = notionReport?.genericGuidance?.length
    ? notionReport.genericGuidance.map(item => `- ${item}`).join('\n')
    : 'None.';

  return [
    prompt,
    '',
    '## Stripe Documentation Findings',
    stripeDocsReport?.docsSummary ?? 'No documentation found.',
    '',
    '## Internal Notion Context',
    notionReport?.notionSummary ?? 'No internal documentation found.',
    '',
    '### Customer-Specific Notion Findings',
    notionCustomerSpecificFindings,
    '',
    '### Generic Internal Guidance',
    notionGenericGuidance,
    ...(accountReport
      ? [
          '',
          '## Stripe Account Investigation',
          accountReport.stripeFindings,
          '',
          '### Supported Account Conclusion',
          accountReport.supportedConclusion ?? 'No supported conclusion provided.',
          '',
          '### Direct Account Evidence',
          accountEvidence,
          '',
          '### Unsupported Hypotheses',
          unsupportedHypotheses,
        ]
      : []),
  ].join('\n');
}

// Normalizes the multi-agent pipeline output into the stable response contract
// consumed by ticket enrichment, evals, and the UI.
export function buildMultiAgentOutput({
  stripeDocsResult,
  notionResult,
  accountResult,
  synthesisResult,
}: {
  stripeDocsResult: AgentResultShape;
  notionResult: AgentResultShape;
  accountResult: AgentResultShape | null;
  synthesisResult: AgentResultShape;
}): EnrichmentOutput {
  const { stripeDocsReport, notionReport, accountReport } = extractResearchReports({
    stripeDocsResult,
    notionResult,
    accountResult,
  });

  const submitCall = synthesisResult.staticToolCalls.find(
    call => call.toolName === 'submitAnalysis',
  )?.input as { diagnosis: string; draftReply: string } | undefined;

  return {
    diagnosis: submitCall?.diagnosis ?? (synthesisResult.text.trim() || 'Analysis unavailable.'),
    draftReply: submitCall?.draftReply ?? '',
    docsSummary: stripeDocsReport?.docsSummary ?? '',
    sources: stripeDocsReport?.sources ?? [],
    notionSummary: notionReport?.notionSummary ?? '',
    notionSources: notionReport?.notionSources ?? [],
    stripeFindings: (
      accountReport?.supportedConclusion?.trim() ||
      accountReport?.stripeFindings
    ) ?? '',
    submitAnalysisCalled: !!submitCall,
    stepCount:
      stripeDocsResult.steps.length +
      notionResult.steps.length +
      (accountResult?.steps.length ?? 0) +
      synthesisResult.steps.length,
  };
}

// Parses the legacy single-agent result and backfills discovered sources from
// tool results so evals still have complete visibility into retrieved context.
export function parseSingleAgentResult(result: AgentResultShape): EnrichmentOutput {
  const discoveredSources = new Map<string, string>();
  const discoveredNotionSources = new Map<string, string>();

  for (const step of result.steps) {
    for (const toolResult of step.toolResults ?? []) {
      if (toolResult.toolName === 'searchStripeDocs') {
        for (const source of (toolResult.output as SearchResult).results) {
          discoveredSources.set(source.url, source.title ?? source.url);
        }
      } else if (toolResult.toolName === 'extractStripePage') {
        for (const source of (toolResult.output as ExtractResponse).results) {
          discoveredSources.set(source.url, source.title ?? source.url);
        }
      } else if (toolResult.toolName === 'searchNotionDocs') {
        const output = toolResult.output as { title: string; url: string; content: string }[] | string;
        if (Array.isArray(output)) {
          for (const source of output) {
            discoveredNotionSources.set(source.url, source.title);
          }
        }
      }
    }
  }

  let diagnosis = '';
  let draftReply = '';
  let docsSummary = '';
  let notionSummary = '';
  let stripeFindings = '';
  let sources: { title: string; url: string }[] = [];
  let notionSources: { title: string; url: string }[] = [];
  let submitAnalysisCalled = false;

  const submitCall = result.staticToolCalls.find(
    call => call.toolName === 'submitAnalysis',
  )?.input as {
    diagnosis: string;
    draftReply: string;
    docsSummary: string;
    sources: { title: string; url: string }[];
    notionSummary: string;
    notionSources: { title: string; url: string }[];
    stripeFindings: string;
  } | undefined;

  if (submitCall) {
    submitAnalysisCalled = true;
    diagnosis = submitCall.diagnosis ?? '';
    draftReply = submitCall.draftReply ?? '';
    docsSummary = submitCall.docsSummary ?? '';
    sources = submitCall.sources ?? [];
    notionSummary = submitCall.notionSummary ?? '';
    notionSources = submitCall.notionSources ?? [];
    stripeFindings = submitCall.stripeFindings ?? '';
  }

  const sourceUrls = new Set(sources.map(source => source.url));
  for (const [url, title] of discoveredSources) {
    if (!sourceUrls.has(url)) {
      sources.push({ url, title });
      sourceUrls.add(url);
    }
  }

  const notionUrls = new Set(notionSources.map(source => source.url));
  for (const [url, title] of discoveredNotionSources) {
    if (!notionUrls.has(url)) {
      notionSources.push({ url, title });
      notionUrls.add(url);
    }
  }

  if (!diagnosis) diagnosis = result.text.trim() || 'Analysis unavailable.';

  return {
    diagnosis,
    draftReply,
    docsSummary,
    sources,
    notionSummary,
    notionSources,
    stripeFindings,
    submitAnalysisCalled,
    stepCount: result.steps.length,
  };
}
