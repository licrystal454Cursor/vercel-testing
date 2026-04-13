import { createExtractTool, createSearchTool } from '@parallel-web/ai-sdk-tools';
import type { ExtractResponse } from 'parallel-web/resources/beta/beta.mjs';
import { getCachedDoc, setCachedDoc } from './docsCache';

export const searchStripeDocs = createSearchTool({
  source_policy: { include_domains: ['docs.stripe.com'] },
  mode: 'agentic',
  max_results: 5,
});

const rawExtractStripePage = createExtractTool({ full_content: true });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rawExtractExecute = (rawExtractStripePage as any).execute as (...args: unknown[]) => Promise<ExtractResponse>;

export const extractStripePage = {
  ...rawExtractStripePage,
  execute: async (...args: unknown[]) => {
    const input = args[0] as { urls?: string[] };
    const url = input.urls?.[0];

    if (url) {
      const cached = await getCachedDoc(url);
      if (cached) return cached as ExtractResponse;
    }

    const result = await rawExtractExecute(...args);
    if (url) {
      await setCachedDoc(url, result);
      console.log('[docs-cache] miss — stored |', url);
    }

    return result;
  },
};
