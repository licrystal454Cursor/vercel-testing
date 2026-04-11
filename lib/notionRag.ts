import { createClient } from '@supabase/supabase-js';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { embed, embedMany } from 'ai';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const gateway = createOpenAICompatible({
  name: 'vercel-ai-gateway',
  baseURL: 'https://ai-gateway.vercel.sh/v1',
  apiKey: process.env.AI_GATEWAY_KEY,
});
const embeddingModel = gateway.textEmbeddingModel('openai/text-embedding-3-small');

const CHUNK_SIZE = 400;   // words per chunk
const CHUNK_OVERLAP = 50; // words of overlap between chunks
const TOP_K = 4;          // chunks to return per query

/** Split text into overlapping word-based chunks */
function chunkText(text: string): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const chunks: string[] = [];
  let start = 0;

  while (start < words.length) {
    const end = Math.min(start + CHUNK_SIZE, words.length);
    chunks.push(words.slice(start, end).join(' '));
    if (end === words.length) break;
    start += CHUNK_SIZE - CHUNK_OVERLAP;
  }

  return chunks;
}

/**
 * Index a Notion page into pgvector.
 * Safe to call multiple times — upserts by (page_id, chunk_index).
 */
export async function indexNotionPage(page: {
  id: string;
  title: string;
  url: string;
  content: string;
}): Promise<void> {
  const chunks = chunkText(page.content);
  if (chunks.length === 0) {
    console.log('[rag] no content to index for page:', page.title);
    return;
  }

  console.log('[rag] indexing page:', page.title, '| chunks:', chunks.length);

  const { embeddings } = await embedMany({
    model: embeddingModel,
    values: chunks,
  });

  const rows = chunks.map((content, i) => ({
    page_id: page.id,
    page_title: page.title,
    page_url: page.url,
    chunk_index: i,
    content,
    embedding: JSON.stringify(embeddings[i]),
  }));

  const { error } = await supabase
    .from('notion_chunks')
    .upsert(rows, { onConflict: 'page_id,chunk_index' });

  if (error) throw new Error(`[rag] index error: ${error.message}`);
  console.log('[rag] indexed', rows.length, 'chunks for:', page.title);
}

/**
 * Find the most relevant Notion chunks for a query.
 * Returns top-k chunks across all indexed pages.
 */
export async function searchNotionChunks(
  query: string,
  opts?: { pageId?: string } // optionally scope to a single page
): Promise<{ pageTitle: string; pageUrl: string; content: string; similarity: number }[]> {
  const { embedding } = await embed({
    model: embeddingModel,
    value: query,
  });

  // Supabase pgvector RPC — you need to create this function (see below)
  const { data, error } = await supabase.rpc('match_notion_chunks', {
    query_embedding: JSON.stringify(embedding),
    match_count: TOP_K,
    match_threshold: 0.5,
    filter_page_id: opts?.pageId ?? null,
  });

  if (error) throw new Error(`[rag] search error: ${error.message}`);

  return (data ?? []).map((row: {
    page_title: string;
    page_url: string;
    content: string;
    similarity: number;
  }) => ({
    pageTitle: row.page_title,
    pageUrl: row.page_url,
    content: row.content,
    similarity: row.similarity,
  }));
}

/**
 * Format retrieved chunks for injection into a system prompt.
 */
export function formatChunksForPrompt(
  chunks: Awaited<ReturnType<typeof searchNotionChunks>>
): string {
  if (chunks.length === 0) return '';
  return (
    `## Relevant Internal Documentation (Notion)\n\n` +
    chunks
      .map((c, i) => `### Excerpt ${i + 1} — ${c.pageTitle}\n${c.pageUrl}\n\n${c.content}`)
      .join('\n\n---\n\n')
  );
}
