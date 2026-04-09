import { createOpenAI } from '@ai-sdk/openai';
import { convertToModelMessages, streamText, UIMessage } from 'ai';

const gateway = createOpenAI({
  baseURL: 'https://ai-gateway.vercel.sh/v1',
  apiKey: process.env.AI_GATEWAY_KEY,
});

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();

  const result = streamText({
    model: gateway('openai/gpt-4.1-mini'),
    messages: await convertToModelMessages(messages),
    system: 'I want you to make sure to include a hello in the response'
  });

  return result.toUIMessageStreamResponse();
}
