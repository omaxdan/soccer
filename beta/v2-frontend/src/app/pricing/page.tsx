import type { Metadata } from 'next';
import { PricingPage } from '@/components/v2/pricing';

// Public Pricing page (B3). Four access levels (Guest, Free, Pro, Elite) described
// in consistent terms. The wireframe is deliberately price-less: entitlements,
// prices and billing terms are shown as "to be confirmed / pending" until they are
// set. Renders inside the Phase A shell; fully static (no API calls).
export const metadata: Metadata = {
  title: 'Pricing — PitchTerminal',
  description:
    'Four PitchTerminal access levels — Guest, Free, Pro and Elite — from a first look to the full depth of match intelligence. Prices and entitlements are confirmed as they are set.',
};

export default function Pricing() {
  return <PricingPage />;
}
