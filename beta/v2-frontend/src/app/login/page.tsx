import type { Metadata } from 'next';
import { LoginForm } from '@/components/v2/loginForm';
import { MarketingFooter } from '@/components/v2/marketing';

// Public Login page (B4). Renders inside the Phase A shell (the design's optional
// reduced auth-frame header/footer is replaced by the standard shell + shared footer,
// per the app's global-shell convention). The sign-in CARD and its client validation
// are real; authentication itself is not implemented (no backend), so a valid submit
// shows an honest "not available yet" state rather than a fabricated session.
export const metadata: Metadata = {
  title: 'Sign in — PitchTerminal',
  description: 'Sign in to PitchTerminal. Accounts and sign-in open in a later release; you can explore PitchTerminal without an account.',
};

export default function Login() {
  return (
    <>
      <main style={{ display: 'flex', justifyContent: 'center', alignItems: 'flex-start', padding: 'clamp(24px,6vw,96px) 16px 64px', boxSizing: 'border-box' }}>
        <LoginForm />
      </main>
      <MarketingFooter />
    </>
  );
}
