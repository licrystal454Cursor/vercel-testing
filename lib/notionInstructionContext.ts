import { fetchNotionPageById, parseNotionPageId } from './notionTool';

export interface PrefetchedNotionPage {
  title: string;
  url: string;
  content: string;
}

const NOTION_URL_PATTERN = /https:\/\/(?:www\.)?notion\.so\/[^\s)]+/g;

export function getInstructionNotionUrls(instructions?: string): string[] {
  if (!instructions) return [];
  return instructions.match(NOTION_URL_PATTERN) ?? [];
}

export async function prefetchInstructionNotionPages(
  instructions?: string,
): Promise<PrefetchedNotionPage[]> {
  const urls = getInstructionNotionUrls(instructions);
  if (urls.length === 0) return [];

  const pages = await Promise.all(urls.map(url => fetchNotionPageById(parseNotionPageId(url))));
  return pages.filter(Boolean) as PrefetchedNotionPage[];
}
