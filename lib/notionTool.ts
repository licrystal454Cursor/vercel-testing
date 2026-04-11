import { Client, isFullPage, isFullBlock } from '@notionhq/client';
import { tool } from 'ai';
import { z } from 'zod';

const notion = new Client({ auth: process.env.NOTION_API_KEY });

/** Extract plain text from a Notion rich_text array */
function richTextToString(richText: { plain_text: string }[]): string {
  return richText.map(t => t.plain_text).join('');
}

/** Recursively extract readable text from a list of blocks, up to ~3000 chars */
async function blocksToText(blockId: string, depth = 0): Promise<string> {
  if (depth > 3) return ''; // don't recurse too deep
  const { results } = await notion.blocks.children.list({ block_id: blockId, page_size: 30 });
  const lines: string[] = [];

  for (const block of results) {
    if (!isFullBlock(block)) continue;
    const type = block.type as string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = (block as any)[type];

    if (type === 'child_page') {
      // Subpage — add its title as a heading then recurse into its content
      const title = data?.title as string | undefined;
      if (title) lines.push(`\n## ${title}`);
      const child = await blocksToText(block.id, depth + 1);
      if (child) lines.push(child);
    } else {
      const text = data?.rich_text ? richTextToString(data.rich_text) : '';
      if (text) lines.push(text);

      // Recurse into children for toggles, callouts, etc.
      if (block.has_children && depth < 3) {
        const child = await blocksToText(block.id, depth + 1);
        if (child) lines.push(child);
      }
    }

    if (lines.join('\n').length > 6000) break;
  }

  return lines.join('\n').slice(0, 6000);
}

/** Extract a Notion page ID from a notion.so URL or a raw ID string */
export function parseNotionPageId(input: string): string {
  // URLs like https://www.notion.so/Title-33febe54e4f780dfa66cecf2ffe7d158
  // or https://www.notion.so/workspace/Title-33febe54e4f780dfa66cecf2ffe7d158
  const urlMatch = input.match(/([a-f0-9]{32})(?:[?#]|$)/i);
  if (urlMatch) return urlMatch[1];
  // Already a bare ID (with or without hyphens)
  return input.replace(/-/g, '');
}

/** Fetch a Notion page's title and text content by page ID. */
export async function fetchNotionPageById(
  pageId: string
): Promise<{ title: string; url: string; content: string } | null> {
  if (!process.env.NOTION_API_KEY) {
    console.warn('[notion] fetchNotionPageById: NOTION_API_KEY not set');
    return null;
  }
  const id = parseNotionPageId(pageId);
  console.log('[notion] fetching page id:', id, '(from input:', pageId, ')');
  try {
    const page = await notion.pages.retrieve({ page_id: id });
    if (!isFullPage(page)) {
      console.warn('[notion] page not full:', id);
      return null;
    }
    const titleProp = Object.values(page.properties).find(
      p => p.type === 'title'
    ) as { type: 'title'; title: { plain_text: string }[] } | undefined;
    const title = titleProp ? richTextToString(titleProp.title) : 'Untitled';
    const content = await blocksToText(page.id);
    console.log('[notion] fetched page:', title, '| content length:', content.length);
    return { title, url: page.url, content };
  } catch (err) {
    console.error('[notion] fetchNotionPageById error for id', id, ':', String(err));
    return null;
  }
}

export const getNotionPage = tool({
  description:
    'Fetch a specific Notion page by its page ID. Use this when you already know the exact page ID you want to read.',
  inputSchema: z.object({
    pageId: z.string().describe('The Notion page ID (with or without hyphens)'),
  }),
  execute: async ({ pageId }) => {
    if (!process.env.NOTION_API_KEY) {
      return 'Notion integration not configured (NOTION_API_KEY missing).';
    }

    const page = await notion.pages.retrieve({ page_id: pageId });
    if (!isFullPage(page)) return 'Could not retrieve full page data.';

    const titleProp = Object.values(page.properties).find(
      p => p.type === 'title'
    ) as { type: 'title'; title: { plain_text: string }[] } | undefined;
    const title = titleProp ? richTextToString(titleProp.title) : 'Untitled';
    const content = await blocksToText(page.id);

    return { title, url: page.url, content };
  },
});

export const searchNotionDocs = tool({
  description:
    'Search internal Notion documentation for relevant guides, known issues, workarounds, and customer-specific context.',
  inputSchema: z.object({
    query: z.string().describe('Search query to find relevant Notion pages'),
  }),
  execute: async ({ query }) => {
    if (!process.env.NOTION_API_KEY) {
      return 'Notion integration not configured (NOTION_API_KEY missing).';
    }

    const { results } = await notion.search({
      query,
      filter: { value: 'page', property: 'object' },
      page_size: 5,
    });

    const pages = results.filter(isFullPage);
    if (pages.length === 0) return 'No relevant Notion pages found.';

    const output = await Promise.all(
      pages.map(async page => {
        const titleProp = Object.values(page.properties).find(
          p => p.type === 'title'
        ) as { type: 'title'; title: { plain_text: string }[] } | undefined;
        const title = titleProp ? richTextToString(titleProp.title) : 'Untitled';
        const url = page.url;
        const content = await blocksToText(page.id);
        return { title, url, content };
      })
    );

    return output;
  },
});
