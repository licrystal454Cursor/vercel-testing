import { Client, isFullPage } from '@notionhq/client';
import { generateText } from 'ai';
import { chatStore } from './chatStore';
import { gateway } from './provider';
import { ticketStore } from './store';

const notion = new Client({ auth: process.env.NOTION_API_KEY });
const AGENT_NOTES_TITLE = 'Agent Notes';
const MAX_CHAT_MESSAGES = 12;

type ParsedSummary = {
  summary: string;
  sources?: { title: string; url: string }[];
};

function richTextToString(richText: { plain_text: string }[]): string {
  return richText.map(item => item.plain_text).join('');
}

function parseStoredSummary(raw: string): ParsedSummary {
  try {
    const parsed = JSON.parse(raw) as Partial<ParsedSummary>;
    return {
      summary: parsed.summary ?? '',
      sources: parsed.sources ?? [],
    };
  } catch {
    return {
      summary: raw || '',
      sources: [],
    };
  }
}

function formatChatTranscript(messages: { role: string; content: string; createdAt: string }[]): string {
  if (messages.length === 0) return 'No internal support chat messages.';

  return messages
    .slice(-MAX_CHAT_MESSAGES)
    .map(message => `[${message.createdAt}] ${message.role}: ${message.content}`)
    .join('\n\n');
}

function parseDebrief(text: string): {
  summary: string;
  details: Array<{ label: string; value: string }>;
} {
  const lines = text
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);

  let summary = '';
  const details: Array<{ label: string; value: string }> = [];

  for (const line of lines) {
    const separatorIndex = line.indexOf(':');
    if (separatorIndex > 0) {
      const label = line.slice(0, separatorIndex).trim();
      const value = line.slice(separatorIndex + 1).trim();
      if (value) {
        details.push({ label, value });
        continue;
      }
    }

    if (!summary) {
      summary = line;
    } else {
      summary += ` ${line}`;
    }
  }

  if (!summary) {
    summary = 'Resolved ticket debrief generated.';
  }

  return { summary, details };
}

async function findAgentNotesPages() {
  const { results } = await notion.search({
    query: AGENT_NOTES_TITLE,
    filter: { value: 'page', property: 'object' },
    page_size: 20,
  });

  return results.filter(page => {
    if (!isFullPage(page)) return false;
    const titleProp = Object.values(page.properties).find(
      property => property.type === 'title',
    ) as { type: 'title'; title: { plain_text: string }[] } | undefined;
    const title = titleProp ? richTextToString(titleProp.title) : '';
    return title === AGENT_NOTES_TITLE;
  });
}

function toParagraphBlock(text: string) {
  return {
    object: 'block' as const,
    type: 'paragraph' as const,
    paragraph: {
      rich_text: [{ type: 'text' as const, text: { content: text.slice(0, 2000) } }],
    },
  };
}

function toBulletedListItem(label: string, value: string) {
  return {
    object: 'block' as const,
    type: 'bulleted_list_item' as const,
    bulleted_list_item: {
      rich_text: [
        {
          type: 'text' as const,
          text: { content: `${label}: ${value}`.slice(0, 2000) },
        },
      ],
    },
  };
}

export async function appendResolvedTicketDebrief(ticketId: string): Promise<void> {
  if (!process.env.NOTION_API_KEY) {
    console.warn('[notion-debrief] skipping — NOTION_API_KEY not set');
    return;
  }

  const ticket = await ticketStore.get(ticketId);
  if (!ticket || ticket.status !== 'resolved') {
    return;
  }

  const agentNotesPages = await findAgentNotesPages();
  if (agentNotesPages.length === 0) {
    console.warn('[notion-debrief] no pages found with title:', AGENT_NOTES_TITLE);
    return;
  }

  const chatMessages = await chatStore.list(ticketId);
  const publicDocs = parseStoredSummary(ticket.publicDocsContent);
  const internalDocs = parseStoredSummary(ticket.notionContent);

  const { text } = await generateText({
    model: gateway('openai/gpt-4.1-mini'),
    maxRetries: 5,
    providerOptions: { gateway: { models: ['anthropic/claude-haiku-4.5', 'google/gemini-2.5-flash-lite'] } },
    prompt: `You are writing an internal support debrief for a Notion page called "${AGENT_NOTES_TITLE}".

Write a concise debrief for a resolved support ticket.

Requirements:
- Output plain text only.
- The first non-empty line must be a 1-2 sentence summary.
- Then provide one line each for:
  Issue:
  Resolution signal:
  Support action:
  Root cause / likely cause:
  Docs / customer context:
  Follow-up:
- If something is unknown, say "Unknown".
- Keep each line concise and useful for internal teammates.

Ticket ID: ${ticket.id}
Created At: ${ticket.createdAt}
Resolved At: ${ticket.resolvedAt ?? 'Unknown'}
Channel: ${ticket.input.channelName ?? ticket.input.channelId}

Original customer issue:
${ticket.input.messageText}

Extracted question:
${ticket.extractedQuestion || 'Unknown'}

AI analysis:
${ticket.aiAnalysis || 'Unknown'}

Public docs summary:
${publicDocs.summary || 'Unknown'}

Internal docs summary:
${internalDocs.summary || 'Unknown'}

Stripe findings:
${ticket.replicationResult || 'Unknown'}

Last support reply:
${ticket.sentReply || 'Unknown'}

Last customer message:
${ticket.lastCustomerMessage || 'Unknown'}

Recent internal support chat:
${formatChatTranscript(chatMessages)}`,
  });

  const debrief = parseDebrief(text);
  const blocks = [
    {
      object: 'block' as const,
      type: 'heading_2' as const,
      heading_2: {
        rich_text: [
          {
            type: 'text' as const,
            text: {
              content: `Ticket ${ticket.id.slice(0, 8)} - Resolved`,
            },
          },
        ],
      },
    },
    toParagraphBlock(debrief.summary),
    ...debrief.details.map(detail => toBulletedListItem(detail.label, detail.value)),
    {
      object: 'block' as const,
      type: 'divider' as const,
      divider: {},
    },
  ];

  await Promise.all(
    agentNotesPages.map(page =>
      notion.blocks.children.append({
        block_id: page.id,
        children: blocks,
      })
    )
  );

  console.log('[notion-debrief] appended resolved ticket update to', agentNotesPages.length, `"${AGENT_NOTES_TITLE}" page(s)`);
}
