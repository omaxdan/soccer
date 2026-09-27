import type { Metadata } from 'next';
import { LegalWorkspace } from '@/components/v2/legal';
import { MarketingFooter } from '@/components/v2/marketing';

// Public Terms page (B8 Legal). The approved Terms of Service has not been published
// yet, so this renders an honest "awaiting approved text" state — no legal policy,
// dates, or company details are invented. Static; renders inside the Phase A shell.
export const metadata: Metadata = {
  title: 'Terms — PitchTerminal',
  description: 'PitchTerminal Terms of Service. The approved document will be published here.',
};

export default function Terms() {
  return (
    <>
      <LegalWorkspace active="Terms" />
      <MarketingFooter />
    </>
  );
}
