import type { AgentConfig } from '@/lib/types';

export interface EvalCase {
  id: string;
  /** Human-readable description of what this case is testing */
  description: string;
  messageText: string;
  agentConfig?: AgentConfig;
  channelContext?: { stripeCustomerId?: string; secretKey?: string };
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
    id: 'payout-delay',
    description: 'Payout timing question — should reference standard payout schedules',
    messageText: 'Why are my payouts delayed? I expected them yesterday but still nothing.',
    constraints: {
      mustMention: ['payout', 'schedule'],
      expectation: 'Should explain standard payout timing, mention the Dashboard payout settings, and note weekends/holidays may cause delays.',
    },
  },
];
