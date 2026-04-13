import { generateId } from 'ai';
import { chatStore } from '../chatStore';
import { buildStripeToolContext } from '../stripeToolkitTools';

type LoggedStep = {
  stepNumber: number;
  text: string;
  content: Array<{ type: string; toolName?: string; output?: unknown; result?: unknown }>;
  toolResults?: Array<{ toolName?: string; output?: unknown; result?: unknown }>;
  tool_results?: Array<{ toolName?: string; output?: unknown; result?: unknown }>;
  results?: Array<{ toolName?: string; output?: unknown; result?: unknown }>;
};

// Drains a server-side copy of the SSE stream so finish hooks still run even if
// the browser disconnects before the stream completes.
export function consumeSseStream({ stream }: { stream: ReadableStream }) {
  const reader = stream.getReader();
  const drain = (): void => {
    reader.read().then(({ done }) => {
      if (!done) drain();
    });
  };
  drain();
}

// Emits a compact step-by-step trace for tool calls and tool results during
// interactive ticket chat.
export function logChatStep(step: LoggedStep) {
  const toolCalls = step.content
    .filter(part => part.type === 'tool-call')
    .map(part => part.toolName);

  console.log('[chat] step', step.stepNumber, '| text length:', step.text.length, '| tool calls:', toolCalls);
  console.log('[chat] step keys:', Object.keys(step));

  const results = step.toolResults ?? step.tool_results ?? step.results;
  if (Array.isArray(results) && results.length > 0) {
    for (const result of results) {
      console.log(
        '[chat] tool result:',
        result.toolName,
        '|',
        JSON.stringify(result.output ?? result.result ?? result).slice(0, 500),
      );
    }
  }

  const resultParts = (step.content ?? []).filter(part => part.type === 'tool-result');
  for (const part of resultParts) {
    console.log(
      '[chat] content tool-result:',
      part.toolName,
      '|',
      JSON.stringify(part.output ?? part.result).slice(0, 500),
    );
  }
}

// Persists the final assistant text and closes the Stripe toolkit only after
// the stream lifecycle has actually completed.
export function createPersistChatFinish({
  ticketId,
  stripeToolkit,
}: {
  ticketId: string;
  stripeToolkit: Awaited<ReturnType<typeof buildStripeToolContext>>['toolkit'] | null;
}) {
  return async ({
    responseMessage,
    isAborted,
  }: {
    responseMessage: {
      id?: string;
      parts?: Array<{ type: string; text?: string }>;
    };
    isAborted: boolean;
  }) => {
    await stripeToolkit?.close();

    console.log('[chat] onFinish |', {
      isAborted,
      hasResponseMessage: !!responseMessage,
      responseMessageId: responseMessage?.id,
      parts: responseMessage?.parts?.map(part => part.type),
    });

    if (!isAborted) {
      const textPart = (responseMessage.parts ?? []).find(
        (part): part is { type: 'text'; text: string } => part.type === 'text',
      );
      const text = textPart?.text ?? '';
      const messageId = responseMessage.id || generateId();
      console.log('[chat] finish | text length:', text.length, '| msgId:', messageId);
      if (text) await chatStore.save(ticketId, messageId, 'assistant', text);
    }
  };
}
