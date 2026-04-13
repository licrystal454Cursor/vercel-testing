import { createStripeAgentToolkit } from '@stripe/agent-toolkit/ai-sdk';
import { tool, type ToolSet } from 'ai';
import Stripe from 'stripe';
import { z } from 'zod';

type ToolMap = ToolSet;
type ToolInstance = ToolMap[string];

function createPaymentMethodConfigurationsTool(secretKey: string) {
  const stripe = new Stripe(secretKey);

  return tool({
    description:
      'List payment method configurations for the Stripe account and show exactly which payment methods (card, ACH/us_bank_account, Link, Apple Pay, SEPA, etc.) are enabled or disabled with their display preferences.',
    inputSchema: z.object({}),
    execute: async () => {
      const list = await stripe.paymentMethodConfigurations.list();

      return Promise.all(
        list.data.map(async summary => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const config = await stripe.paymentMethodConfigurations.retrieve(summary.id) as Record<string, any>;
          const methods: Record<string, { available: boolean; preference: string }> = {};

          for (const [key, val] of Object.entries(config)) {
            if (val && typeof val === 'object' && 'available' in val) {
              methods[key] = {
                available: val.available as boolean,
                preference: val.display_preference?.value ?? 'unknown',
              };
            }
          }

          return {
            id: config.id as string,
            name: config.name as string,
            active: config.active as boolean,
            livemode: config.livemode as boolean,
            is_default: config.is_default as boolean,
            payment_methods: methods,
          };
        })
      );
    },
  });
}

export function withToolLogging<T extends ToolInstance>(name: string, toolToWrap: T): T {
  const executableTool = toolToWrap as T & {
    execute?: (...args: unknown[]) => Promise<unknown>;
  };

  if (!executableTool.execute) return toolToWrap;

  return {
    ...toolToWrap,
    execute: async (...args: unknown[]) => {
      const start = Date.now();
      console.log(`[tool:${name}] called | input:`, JSON.stringify(args).slice(0, 300));
      try {
        const result = await executableTool.execute?.(...args);
        console.log(`[tool:${name}] ok | ${Date.now() - start}ms | output:`, JSON.stringify(result).slice(0, 500));
        return result;
      } catch (err) {
        console.error(`[tool:${name}] ERROR | ${Date.now() - start}ms |`, String(err));
        throw err;
      }
    },
  } as T;
}

export async function buildStripeToolContext({
  secretKey,
  excludeDocumentationSearch = false,
  wrapTool,
}: {
  secretKey: string;
  excludeDocumentationSearch?: boolean;
  wrapTool?: <T extends ToolInstance>(name: string, toolToWrap: T) => T;
}): Promise<{
  toolkit: Awaited<ReturnType<typeof createStripeAgentToolkit>>;
  tools: ToolMap;
  toolNames: string[];
}> {
  const toolkit = await createStripeAgentToolkit({
    secretKey,
    configuration: {},
  });

  const rawTools = toolkit.getTools() as ToolMap;
  const filteredEntries = Object.entries(rawTools).filter(
    ([name]) => !excludeDocumentationSearch || name !== 'search_stripe_documentation'
  );

  const tools = Object.fromEntries(
    filteredEntries.map(([name, toolToWrap]) => [
      name,
      wrapTool ? wrapTool(name, toolToWrap as ToolInstance) : toolToWrap,
    ])
  ) as ToolMap;

  const paymentMethodTool = createPaymentMethodConfigurationsTool(secretKey);
  tools.get_payment_method_configurations = wrapTool
    ? wrapTool('get_payment_method_configurations', paymentMethodTool)
    : paymentMethodTool;

  return {
    toolkit,
    tools,
    toolNames: Object.keys(tools),
  };
}
