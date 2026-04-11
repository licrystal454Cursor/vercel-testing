import { generateText, Output } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { z } from 'zod';
import type { EnrichmentOutput } from '@/lib/runEnrichmentAgent';
import type { EvalCase } from './dataset';

const gateway = createOpenAICompatible({
  name: 'vercel-ai-gateway',
  baseURL: 'https://ai-gateway.vercel.sh/v1',
  apiKey: process.env.AI_GATEWAY_KEY,
});

export interface Score {
  name: string;
  pass: boolean;
  score: number; // 0–1
  reason: string;
}

// ---------------------------------------------------------------------------
// Code-based scorers (fast, deterministic)
// ---------------------------------------------------------------------------

export function scoreSubmitAnalysisCalled(output: EnrichmentOutput): Score {
  return {
    name: 'submit_analysis_called',
    pass: output.submitAnalysisCalled,
    score: output.submitAnalysisCalled ? 1 : 0,
    reason: output.submitAnalysisCalled
      ? 'Agent called submitAnalysis as required.'
      : 'Agent never called submitAnalysis — output may be incomplete.',
  };
}

export function scoreNonEmptyDiagnosis(output: EnrichmentOutput): Score {
  const pass = output.diagnosis.trim().length > 50;
  return {
    name: 'non_empty_diagnosis',
    pass,
    score: pass ? 1 : 0,
    reason: pass
      ? `Diagnosis has ${output.diagnosis.length} chars.`
      : `Diagnosis is too short (${output.diagnosis.length} chars) — may be a failure fallback.`,
  };
}

export function scoreNonEmptyDraftReply(output: EnrichmentOutput): Score {
  const pass = output.draftReply.trim().length > 30;
  return {
    name: 'non_empty_draft_reply',
    pass,
    score: pass ? 1 : 0,
    reason: pass
      ? `Draft reply has ${output.draftReply.length} chars.`
      : `Draft reply is empty or very short.`,
  };
}

export function scoreHasStripeSources(output: EnrichmentOutput): Score {
  const pass = output.sources.length > 0;
  return {
    name: 'has_stripe_sources',
    pass,
    score: pass ? 1 : 0,
    reason: pass
      ? `Found ${output.sources.length} Stripe doc source(s).`
      : 'No Stripe documentation sources were found — searchStripeDocs may not have run.',
  };
}

export function scoreMustNotMention(output: EnrichmentOutput, evalCase: EvalCase): Score {
  const banned = evalCase.constraints.mustNotMention ?? [];
  if (banned.length === 0) {
    return { name: 'must_not_mention', pass: true, score: 1, reason: 'No banned terms for this case.' };
  }

  const text = (output.draftReply + ' ' + output.diagnosis).toLowerCase();
  const violations = banned.filter(phrase => text.includes(phrase.toLowerCase()));
  const pass = violations.length === 0;

  return {
    name: 'must_not_mention',
    pass,
    score: pass ? 1 : 0,
    reason: pass
      ? `No banned terms found. Checked: ${banned.join(', ')}`
      : `Output mentions banned term(s): ${violations.join(', ')}`,
  };
}

export function scoreMustMention(output: EnrichmentOutput, evalCase: EvalCase): Score {
  const required = evalCase.constraints.mustMention ?? [];
  if (required.length === 0) {
    return { name: 'must_mention', pass: true, score: 1, reason: 'No required terms for this case.' };
  }

  const text = (output.draftReply + ' ' + output.diagnosis).toLowerCase();
  const missing = required.filter(phrase => !text.includes(phrase.toLowerCase()));
  const pass = missing.length === 0;
  const hit = required.length - missing.length;

  return {
    name: 'must_mention',
    pass,
    score: hit / required.length,
    reason: pass
      ? `All required terms found: ${required.join(', ')}`
      : `Missing required term(s): ${missing.join(', ')}`,
  };
}

// ---------------------------------------------------------------------------
// LLM-as-judge scorers (slower, semantic)
// ---------------------------------------------------------------------------

const judgeSchema = z.object({
  pass: z.boolean().describe('Whether the output passes this criterion'),
  score: z.number().min(0).max(1).describe('Score from 0 (worst) to 1 (best)'),
  reason: z.string().describe('Concise explanation of the score (1-2 sentences)'),
});

export async function scoreDraftReplyRelevance(
  output: EnrichmentOutput,
  evalCase: EvalCase,
): Promise<Score> {
  if (!output.draftReply.trim()) {
    return { name: 'draft_reply_relevance', pass: false, score: 0, reason: 'Draft reply is empty.' };
  }

  const { output: judged } = await generateText({
    model: gateway('openai/gpt-4.1-mini'),
    output: Output.object({ schema: judgeSchema }),
    prompt: `You are evaluating whether a support agent's draft reply is relevant and helpful for the customer's question.

Customer message: "${evalCase.messageText}"
${evalCase.constraints.expectation ? `Expected answer quality: ${evalCase.constraints.expectation}` : ''}

Draft reply:
${output.draftReply}

Score this draft reply from 0 to 1:
- 1.0: Directly addresses the question with accurate, actionable information
- 0.5: Partially relevant but missing key information or too vague
- 0.0: Off-topic, incorrect, or unhelpful`,
  });

  return { name: 'draft_reply_relevance', ...judged };
}

export async function scoreConstraintCompliance(
  output: EnrichmentOutput,
  evalCase: EvalCase,
): Promise<Score> {
  const hasConstraints =
    (evalCase.constraints.mustNotMention?.length ?? 0) > 0 ||
    (evalCase.constraints.mustMention?.length ?? 0) > 0 ||
    evalCase.constraints.expectation;

  if (!hasConstraints) {
    return {
      name: 'constraint_compliance',
      pass: true,
      score: 1,
      reason: 'No specific constraints to check for this case.',
    };
  }

  const constraintDescription = [
    evalCase.constraints.mustNotMention?.length
      ? `Must NOT mention: ${evalCase.constraints.mustNotMention.join(', ')}`
      : '',
    evalCase.constraints.mustMention?.length
      ? `Must mention: ${evalCase.constraints.mustMention.join(', ')}`
      : '',
    evalCase.constraints.expectation ? `Expected: ${evalCase.constraints.expectation}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const { output: judged } = await generateText({
    model: gateway('openai/gpt-4.1-mini'),
    output: Output.object({ schema: judgeSchema }),
    prompt: `You are checking whether a support agent's response complies with specific constraints.

Context: The support agent is responding to a customer with the following message:
"${evalCase.messageText}"

${evalCase.agentConfig ? `Agent is configured with special instructions:\n${evalCase.agentConfig.instructions}\n` : ''}

Constraints that must be satisfied:
${constraintDescription}

Full response (diagnosis + draft reply):
DIAGNOSIS: ${output.diagnosis}

DRAFT REPLY: ${output.draftReply}

Does this response comply with ALL constraints? Score:
- 1.0: Fully compliant — all constraints satisfied
- 0.5: Partially compliant — some constraints met, some violated
- 0.0: Non-compliant — violates one or more constraints`,
  });

  return { name: 'constraint_compliance', ...judged };
}

// ---------------------------------------------------------------------------
// Run all scorers for a single case
// ---------------------------------------------------------------------------

export async function scoreAll(
  output: EnrichmentOutput,
  evalCase: EvalCase,
): Promise<Score[]> {
  const codeScores: Score[] = [
    scoreSubmitAnalysisCalled(output),
    scoreNonEmptyDiagnosis(output),
    scoreNonEmptyDraftReply(output),
    scoreHasStripeSources(output),
    scoreMustNotMention(output, evalCase),
    scoreMustMention(output, evalCase),
  ];

  const llmScores = await Promise.all([
    scoreDraftReplyRelevance(output, evalCase),
    scoreConstraintCompliance(output, evalCase),
  ]);

  return [...codeScores, ...llmScores];
}
