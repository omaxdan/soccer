import type { Metadata } from 'next';
import { LegalWorkspace } from '@/components/v2/legal';
import { MarketingFooter } from '@/components/v2/marketing';

// Public Privacy page (B8 Legal). The approved Privacy Policy has not been published
// yet, so this renders an honest "awaiting approved text" state — no legal policy,
// dates, data-processing claims, or company details are invented. Static; renders
// inside the Phase A shell.
export const metadata: Metadata = {
  title: 'Privacy — PitchTerminal',
  description: 'PitchTerminal Privacy Policy. The approved document will be published here.',
};

export default function Privacy() {
  return (
    <>
      <LegalWorkspace active="Privacy" />
      <MarketingFooter />
    </>
  );
}
