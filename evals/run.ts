/**
 * Eval runner — executes every case in the dataset through the enrichment agent
 * and scores the output.
 *
 * Run with:
 *   npx tsx evals/run.ts
 *   npx tsx evals/run.ts --case no-customer-portal   # run one case by ID
 */

import './loadenv'; // Must be first — sets process.env before any module initializes
import { tool } from 'ai';
import { z } from 'zod';
import { dataset } from './dataset';
import { scoreAll, type Score } from './scorers';
import { runEnrichmentAgent } from '../lib/runEnrichmentAgent';
import type { EvalCase } from './dataset';

// ---------------------------------------------------------------------------
// Mocked tools — keep evals deterministic and free of external side-effects
// ---------------------------------------------------------------------------

/** Build a Notion mock that returns the case's fixture pages (or empty if none). */
function makeNotionMock(evalCase: EvalCase) {
  const fixture = evalCase.notionFixture ?? [];
  return tool({
    description: 'Search internal Notion documentation (stubbed for evals).',
    inputSchema: z.object({ query: z.string() }),
    execute: async (): Promise<string | { title: string; url: string; content: string; }[]> => fixture,
  });
}

// ---------------------------------------------------------------------------
// CLI arg: optional --case filter
// ---------------------------------------------------------------------------
const caseArg = process.argv.indexOf('--case');
const caseFilter = caseArg !== -1 ? process.argv[caseArg + 1] : null;
const cases = caseFilter ? dataset.filter(c => c.id === caseFilter) : dataset;

if (cases.length === 0) {
  console.error(`No eval cases found${caseFilter ? ` matching "${caseFilter}"` : ''}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

interface EvalResult {
  caseId: string;
  description: string;
  scores: Score[];
  passed: number;
  total: number;
  passRate: number;
  durationMs: number;
  error?: string;
}

async function runCase(evalCase: EvalCase): Promise<EvalResult> {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`▶ ${evalCase.id} — ${evalCase.description}`);
  console.log(`  Message: "${evalCase.messageText.slice(0, 80)}${evalCase.messageText.length > 80 ? '...' : ''}"`);

  const start = Date.now();

  try {
    const output = await runEnrichmentAgent(
      evalCase.messageText,
      evalCase.agentConfig,
      evalCase.channelContext,
      {
        toolOverrides: { searchNotionDocs: makeNotionMock(evalCase) },
        model: evalCase.modelOverride,
      },
    );

    const scores = await scoreAll(output, evalCase);
    const passed = scores.filter(s => s.pass).length;
    const total = scores.length;
    const durationMs = Date.now() - start;

    console.log(`\n  Results (${passed}/${total} passed, ${durationMs}ms):`);
    for (const score of scores) {
      const icon = score.pass ? '✓' : '✗';
      const pct = Math.round(score.score * 100);
      console.log(`  ${icon} [${pct.toString().padStart(3)}%] ${score.name}: ${score.reason}`);
    }

    return {
      caseId: evalCase.id,
      description: evalCase.description,
      scores,
      passed,
      total,
      passRate: passed / total,
      durationMs,
    };
  } catch (err) {
    const durationMs = Date.now() - start;
    const error = err instanceof Error ? err.message : String(err);
    console.error(`  ERROR: ${error}`);
    // Log full cause chain so validation errors show the field/value that failed
    let cause: unknown = err instanceof Error ? (err as Error & { cause?: unknown }).cause : undefined;
    let depth = 0;
    while (cause != null && depth < 3) {
      const msg = cause instanceof Error ? cause.message : String(cause);
      console.error(`  CAUSE[${depth + 1}]: ${msg.slice(0, 500)}`);
      cause = cause instanceof Error ? (cause as Error & { cause?: unknown }).cause : undefined;
      depth++;
    }
    return {
      caseId: evalCase.id,
      description: evalCase.description,
      scores: [],
      passed: 0,
      total: 0,
      passRate: 0,
      durationMs,
      error,
    };
  }
}

async function main() {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`Eval run — ${cases.length} case(s)`);
  console.log(`${'═'.repeat(60)}`);

  const results: EvalResult[] = [];

  // Run sequentially to avoid hammering rate limits
  for (const evalCase of cases) {
    const result = await runCase(evalCase);
    results.push(result);
  }

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------
  console.log(`\n${'═'.repeat(60)}`);
  console.log('SUMMARY');
  console.log(`${'═'.repeat(60)}`);

  let totalPassed = 0;
  let totalChecks = 0;

  for (const r of results) {
    const icon = r.error ? '✗' : r.passRate === 1 ? '✓' : '~';
    const pct = r.error ? 'ERROR' : `${Math.round(r.passRate * 100)}%`;
    console.log(`  ${icon} ${r.caseId.padEnd(32)} ${pct.padStart(5)}  (${r.durationMs}ms)`);
    totalPassed += r.passed;
    totalChecks += r.total;
  }

  const overallPct = totalChecks > 0 ? Math.round((totalPassed / totalChecks) * 100) : 0;
  console.log(`\n  Overall: ${totalPassed}/${totalChecks} checks passed (${overallPct}%)`);

  // Highlight failures
  const failures = results.flatMap(r =>
    r.scores
      .filter(s => !s.pass)
      .map(s => ({ caseId: r.caseId, score: s }))
  );

  if (failures.length > 0) {
    console.log(`\n  Failures:`);
    for (const { caseId, score } of failures) {
      console.log(`  ✗ ${caseId} / ${score.name}: ${score.reason}`);
    }
  }

  console.log('');

  // Exit with non-zero if any checks failed (useful in CI)
  process.exit(failures.length > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Eval runner crashed:', err);
  process.exit(1);
});
