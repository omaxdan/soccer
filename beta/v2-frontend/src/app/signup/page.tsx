import type { Metadata } from 'next';
import { SignupForm } from '@/components/v2/signupForm';
import { MarketingFooter } from '@/components/v2/marketing';

// Public Sign Up page (B5). The account-creation counterpart to B4 Login, rendered
// inside the Phase A shell + shared footer. The card UI and client validation are
// real; account creation is not implemented (no backend), so a valid submit shows an
// honest "not available yet" state rather than a fabricated account/session.
export const metadata: Metadata = {
  title: 'Create your account — PitchTerminal',
  description: 'Create a PitchTerminal account. Accounts open in a later release; you can explore PitchTerminal without an account.',
};

export default function SignUp() {
  return (
    <>
      <main style={{ display: 'flex', justifyContent: 'center', alignItems: 'flex-start', padding: 'clamp(24px,6vw,96px) 16px 64px', boxSizing: 'border-box' }}>
        <SignupForm />
      </main>
      <MarketingFooter />
    </>
  );
}
