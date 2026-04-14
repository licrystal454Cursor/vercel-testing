import Stripe from 'stripe';
import { tool } from 'ai';
import { z } from 'zod';

const STRIPE_SANDBOX_SECRET_KEY_ENV = 'STRIPE_SANDBOX_SECRET_KEY';

function getSandboxStripeClient() {
  const secretKey = process.env.STRIPE_SANDBOX_SECRET_KEY;
  if (!secretKey) {
    throw new Error(
      `${STRIPE_SANDBOX_SECRET_KEY_ENV} is not configured. Sandbox checkout sessions are unavailable.`,
    );
  }

  return new Stripe(secretKey);
}

// Creates short-lived test payment artifacts in the internal sandbox account so
// the support agent can confirm behavior without writing anything to a
// customer's Stripe account.
export function createSandboxCheckoutSessionTool(ticketId: string) {
  return tool({
    description:
      'Create a Checkout Session in the internal Stripe sandbox account only. Never use this for the customer account.',
    inputSchema: z.object({
      productName: z.string().min(1).max(120).describe('Short label for the sandbox product or scenario'),
      amount: z.number().int().positive().max(1_000_000).describe('Amount in the smallest currency unit, such as cents'),
      currency: z.string().length(3).default('usd').describe('Three-letter ISO currency code, for example usd'),
      quantity: z.number().int().positive().max(100).default(1).describe('How many units the Checkout Session should include'),
      paymentMethodTypes: z.array(z.string().min(1)).max(10).optional().describe('Optional Stripe Checkout payment method types, for example ["card"] or ["us_bank_account"]'),
      notes: z.string().max(500).optional().describe('Optional short note about what behavior this Checkout Session is intended to test'),
    }),
    execute: async ({ productName, amount, currency, quantity, paymentMethodTypes, notes }) => {
      const stripe = getSandboxStripeClient();
      const normalizedCurrency = currency.toLowerCase();
      const normalizedPaymentMethodTypes = paymentMethodTypes?.map(type => type.trim()).filter(Boolean);
      const metadata = {
        ticket_id: ticketId,
        source: 'support-dashboard-chat-agent',
        purpose: 'sandbox-checkout-session-test',
        notes: notes ?? '',
      };

      const product = await stripe.products.create({
        name: productName,
        metadata,
      });

      const price = await stripe.prices.create({
        product: product.id,
        unit_amount: amount,
        currency: normalizedCurrency,
        metadata,
      });

      const checkoutSession = await stripe.checkout.sessions.create({
        mode: 'payment',
        line_items: [{ price: price.id, quantity }],
        payment_method_types: normalizedPaymentMethodTypes as Stripe.Checkout.SessionCreateParams.PaymentMethodType[] | undefined,
        success_url: 'https://example.com/success?session_id={CHECKOUT_SESSION_ID}',
        cancel_url: 'https://example.com/cancel',
        metadata,
      });

      if (checkoutSession.livemode) {
        throw new Error('Refusing to return a Checkout Session because the sandbox tool created a live-mode resource.');
      }

      return {
        url: checkoutSession.url,
        checkoutSessionId: checkoutSession.id,
        productId: product.id,
        priceId: price.id,
        livemode: checkoutSession.livemode,
        currency: normalizedCurrency,
        unitAmount: amount,
        quantity,
        paymentMethodTypes: normalizedPaymentMethodTypes ?? null,
      };
    },
  });
}
