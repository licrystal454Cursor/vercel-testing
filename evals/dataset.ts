import type { AgentConfig } from '@/lib/types';
import type { AgentModelId } from '@/lib/provider';
import type { NotionSearchResultPage } from '@/lib/notionTool';

export type NotionFixturePage = NotionSearchResultPage;

export interface EvalCase {
  id: string;
  /** Human-readable description of what this case is testing */
  description: string;
  messageText: string;
  agentConfig?: AgentConfig;
  channelContext?: { stripeCustomerId?: string; secretKey?: string };
  /**
   * Override the model used by the agent for this case.
   * Defaults to 'enrichment-fast' if omitted.
   */
  modelOverride?: AgentModelId;
  /**
   * Pages returned by the Notion mock for this case.
   * If omitted, the mock returns an empty array.
   */
  notionFixture?: NotionFixturePage[];
  /** What the output should/shouldn't contain — used by scorers */
  constraints: {
    /** Phrases/words the draft reply MUST NOT mention */
    mustNotMention?: string[];
    /** Phrases/words the draft reply MUST mention */
    mustMention?: string[];
    /** Free-text description of the expected answer quality */
    expectation?: string;
  };
}

/** Stub AgentConfig without DB IDs for eval use */
function makeAgentConfig(instructions: string): AgentConfig {
  return {
    id: 'eval-agent',
    name: 'Eval Agent',
    instructions,
    createdAt: new Date().toISOString(),
  };
}

export const dataset: EvalCase[] = [
  {
    id: 'basic-payment-failure',
    description: 'Basic card decline — agent should explain decline codes and suggest next steps',
    messageText: 'My payment keeps getting declined with error code card_declined. What should I do?',
    constraints: {
      mustMention: ['decline', 'card'],
      expectation: 'Should explain what card_declined means and give actionable steps like retry or use a different card.',
    },
  },
  {
    id: 'webhook-not-firing',
    description: 'Webhook delivery failure — agent should diagnose and reference Stripe docs',
    messageText: 'Our webhooks stopped firing after we updated our endpoint URL. Events show as failed in the dashboard.',
    constraints: {
      mustMention: ['webhook', 'endpoint'],
      expectation: 'Should mention re-registering the endpoint URL in the Stripe dashboard and checking webhook logs.',
    },
  },
  {
    id: 'refund-timing',
    description: 'Customer asking about refund timeline',
    messageText: 'I issued a refund 2 days ago but my customer has not received it yet. How long does it take?',
    constraints: {
      mustMention: ['5', '10', 'business days'],
      expectation: 'Should give a realistic refund timeline (typically 5-10 business days depending on bank).',
    },
  },
  {
    id: 'no-customer-portal',
    description: 'Regression: agent must NOT recommend customer portal when instructions say not to use it',
    messageText: 'How can my customers manage their subscriptions and update their payment methods?',
    agentConfig: makeAgentConfig(
      `This customer does NOT use the Stripe Customer Portal. Do not recommend it.
They manage subscriptions entirely through a custom-built internal admin interface.
Direct all subscription management questions to their internal admin dashboard.`
    ),
    constraints: {
      mustNotMention: ['customer portal', 'billing portal'],
      mustMention: ['admin', 'internal'],
      expectation: 'Should recommend the customer\'s internal admin dashboard, not the Stripe Customer Portal.',
    },
  },
  {
    id: 'subscription-cancel-flow',
    description: 'Cancellation flow — agent should give correct API approach',
    messageText: 'What is the best way to let customers cancel their own subscriptions?',
    constraints: {
      mustMention: ['subscription', 'cancel'],
      expectation: 'Should describe either the Customer Portal cancel flow or the subscriptions.update/cancel API.',
    },
  },
  {
    id: 'subscription-cancel-no-portal',
    description: 'Cancellation flow — Notion says no Customer Portal, agent must recommend API-only approach',
    messageText: 'What is the best way to let customers cancel their own subscriptions?',
    notionFixture: [
      {
        title: 'Customer Billing Setup',
        url: 'https://notion.so/customer-billing-setup',
        content: 'Customer is not using the Customer Portal. All subscription management must be handled via the API or a custom-built interface.',
      },
    ],
    constraints: {
      mustNotMention: ['customer portal', 'billing portal'],
      mustMention: ['subscription', 'cancel'],
      expectation:
        'Notion context says the customer does not use the Customer Portal. The agent should recommend the subscriptions.update or subscriptions.cancel API (or a custom UI) and must not suggest the Customer Portal as an option.',
    },
  },
  {
    id: 'subscription-cancel-no-portal-reasoning',
    description: 'Same as subscription-cancel-no-portal but using enrichment-reasoning model to compare compliance',
    messageText: 'What is the best way to let customers cancel their own subscriptions?',
    modelOverride: 'enrichment-reasoning',
    notionFixture: [
      {
        title: 'Customer Billing Setup',
        url: 'https://notion.so/customer-billing-setup',
        content: 'Customer is not using the Customer Portal. All subscription management must be handled via the API or a custom-built interface.',
      },
    ],
    constraints: {
      mustNotMention: ['customer portal', 'billing portal'],
      mustMention: ['subscription', 'cancel'],
      expectation:
        'Notion context says the customer does not use the Customer Portal. The agent should recommend the subscriptions.update or subscriptions.cancel API (or a custom UI) and must not suggest the Customer Portal as an option.',
    },
  },
  {
    id: 'payout-delay',
    description: 'Payout timing question — should reference standard payout schedules',
    messageText: 'Why are my payouts delayed? I expected them yesterday but still nothing.',
    constraints: {
      mustMention: ['payout', 'schedule'],
      expectation: 'Should explain standard payout timing, mention the Dashboard payout settings, and note weekends/holidays may cause delays.',
    },
  },
  {
    id: 'bank-payments-link-context',
    description: 'Bank payments visible in checkout — Notion context explains Link instant bank payments',
    messageText: 'Bank payments are showing up in my checkout session but I have ACH turned off. Why?',
    notionFixture: [
      {
        title: 'Link Instant Bank Payments',
        url: 'https://notion.so/link-instant-bank-payments',
        content:
          'Customer has Link instant bank payments enabled. Link instant bank payments will force bank payments to show up even if ACH is turned off.',
      },
    ],
    constraints: {
      mustMention: ['link instant bank payments', 'ACH'],
      expectation:
        'Should explain that Link instant bank payments forces bank payment methods to appear regardless of ACH settings, and advise the customer to disable Link instant bank payments if they do not want bank payments shown.',
    },
  },
  {
    id: 'bank-payments-no-notion-context',
    description: 'Bank payments visible in checkout — no Notion context, agent must not invent Link explanation',
    messageText: 'Bank payments are showing up in my checkout session but I have ACH turned off. Why?',
    constraints: {
      mustNotMention: ['link instant bank payments'],
      expectation:
        'Without internal Notion context the agent should give a general explanation of why bank payment methods may appear (e.g. other enabled payment methods, Stripe automatic payment methods) without specifically attributing it to Link instant bank payments.',
    },
  },
];
