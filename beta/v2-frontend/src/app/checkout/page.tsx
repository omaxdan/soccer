import type { Metadata } from 'next';
import { CheckoutPage, type CheckoutPlan } from '@/components/v2/checkout';
import { MarketingFooter } from '@/components/v2/marketing';

// Public Checkout page (B6). A truthful checkout SURFACE only — there is no payment
// provider, billing backend, or authentication, so nothing is charged and no payment
// details are collected. Renders inside the Phase A shell + shared footer. Reads an
// optional ?plan=pro|elite to show which level's summary; defaults to Pro. No data
// fetching.
export const metadata: Metadata = {
  title: 'Checkout — PitchTerminal',
  description: 'Review your PitchTerminal plan. Checkout is not available yet — prices, billing terms and the payment provider are still to be confirmed; nothing is charged.',
};

function resolvePlan(raw: string | string[] | undefined): CheckoutPlan {
  const v = (Array.isArray(raw) ? raw[0] : raw)?.toLowerCase();
  return v === 'elite' ? 'Elite' : 'Pro';
}

export default async function Checkout({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  return (
    <>
      <CheckoutPage plan={resolvePlan(sp.plan)} />
      <MarketingFooter />
    </>
  );
}
