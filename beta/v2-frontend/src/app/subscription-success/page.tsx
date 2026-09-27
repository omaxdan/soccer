import type { Metadata } from 'next';
import { SubscriptionSuccessPage } from '@/components/v2/subscriptionSuccess';
import { MarketingFooter } from '@/components/v2/marketing';

// Public Subscription Success page (B7). This route is NOT proof of a subscription:
// there is no billing/subscription backend and no verified payment confirmation, so
// it renders an honest "no subscription to confirm" state rather than a fabricated
// success. Renders inside the Phase A shell + shared footer; fully static, no data.
export const metadata: Metadata = {
  title: 'Subscription — PitchTerminal',
  description: 'Subscription confirmation. Checkout and subscriptions are not available yet — no payment is taken and no subscription is created; this page confirms a subscription once billing is set up.',
};

export default function SubscriptionSuccess() {
  return (
    <>
      <SubscriptionSuccessPage />
      <MarketingFooter />
    </>
  );
}
