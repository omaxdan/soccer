'use client';
// SIGN UP FORM (B5) — the interactive account-creation card. Client component.
// The account-creation counterpart to B4 Login, and it makes the SAME honesty
// guarantees.
//
// What is REAL here: the form UI and client-side validation (email format, password
// required, confirm-password match), show/hide for both password fields, and
// accessible labelling/errors.
//
// What is NOT real: account creation. There is no account-creation backend for this
// app (the V2 read API has no registration endpoint; the frontend has no auth
// client). The form makes NO network request, stores NO credentials (state is in
// memory only — never logged, persisted, or put in the URL), and creates NO account
// or session. On a valid submit it shows an honest "not available yet" message —
// never a fabricated "Account created" success or an "email already exists" error.
// The design's own "AUTH IMPLEMENTATION PENDING" / "PASSWORD RULES PENDING"
// annotations are preserved to say so. Password rules are intentionally not invented.

import { useId, useState } from 'react';
import Link from 'next/link';
import { routes } from '@/lib/v2/routes';
import { TextField } from '@/components/v2/form';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function PendingBadge({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ font: "600 8.5px 'JetBrains Mono',monospace", letterSpacing: '.08em', color: 'var(--warn)', border: '1px dashed var(--warn)', borderRadius: 3, padding: '1px 4px' }}>{children}</span>
  );
}

export function SignupForm() {
  const uid = useId();
  const emailId = `${uid}-email`, pwId = `${uid}-pw`, cfId = `${uid}-cf`;
  const emailErrId = `${uid}-ee`, pwErrId = `${uid}-pe`, cfErrId = `${uid}-ce`;

  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [cf, setCf] = useState('');
  const [pwShown, setPwShown] = useState(false);
  const [cfShown, setCfShown] = useState(false);
  const [touched, setTouched] = useState(false);
  const [unavailable, setUnavailable] = useState(false);

  const emailOk = EMAIL_RE.test(email);
  const pwOk = pw.length > 0;
  const cfOk = cf.length > 0 && cf === pw;
  const emailInvalid = touched && !emailOk;
  const pwInvalid = touched && !pwOk;
  const cfInvalid = touched && !cfOk;

  function clearUnavailable() { if (unavailable) setUnavailable(false); }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!emailOk || !pwOk || !cfOk) { setTouched(true); return; }
    // Fields are valid, but there is no account-creation backend — report that
    // honestly. No request is made and nothing is stored.
    setUnavailable(true);
  }

  const toggle = (shown: boolean, set: (v: boolean) => void, controls: string) => (
    <button type="button" onClick={() => set(!shown)} aria-pressed={shown} aria-controls={controls}
      style={{ position: 'absolute', right: 4, top: 4, height: 36, padding: '0 10px', background: 'transparent', border: 0, borderRadius: 4, font: "500 10px 'JetBrains Mono',monospace", letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--muted)', cursor: 'pointer' }}>
      {shown ? 'Hide' : 'Show'}
    </button>
  );

  return (
    <section aria-labelledby={`${uid}-h`} className="panel" style={{ width: '100%', maxWidth: 400, padding: 32, display: 'flex', flexDirection: 'column', gap: 20, boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <span style={{ font: "400 10px 'JetBrains Mono',monospace", letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--muted)' }}>Sign up</span>
          <PendingBadge>AUTH IMPLEMENTATION PENDING</PendingBadge>
        </div>
        <h1 id={`${uid}-h`} style={{ margin: 0, font: '700 22px/1.2 Inter,sans-serif', color: 'var(--text)' }}>Create your account</h1>
        <p style={{ margin: 0, font: '400 14px/1.5 Inter,sans-serif', color: 'var(--text-secondary)' }}>Create an account to sign in to PitchTerminal.</p>
      </div>

      {unavailable && (
        <div role="alert" style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '10px 12px', border: '1px solid var(--warn)', borderRadius: 4, background: 'color-mix(in srgb, var(--warn) 10%, transparent)' }}>
          <span aria-hidden style={{ flex: 'none', width: 18, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--warn)', borderRadius: 3, font: "700 11px 'JetBrains Mono',monospace", color: 'var(--warn)' }}>!</span>
          <span style={{ font: '400 13px/1.45 Inter,sans-serif', color: 'var(--text)' }}>Account creation isn’t available yet — accounts open in a later release. You can explore PitchTerminal without an account.</span>
        </div>
      )}

      <form onSubmit={onSubmit} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <TextField
          id={emailId} label="Email" name="email" type="email" autoComplete="email" inputMode="email"
          placeholder="name@example.com"
          value={email}
          onChange={(v) => { setEmail(v); clearUnavailable(); }}
          invalid={emailInvalid} errorId={emailErrId}
          error={email ? 'Enter a complete email address.' : 'Enter your email address.'}
        />

        <TextField
          id={pwId} label="Password" name="new-password" type={pwShown ? 'text' : 'password'} autoComplete="new-password"
          value={pw}
          onChange={(v) => { setPw(v); clearUnavailable(); }}
          invalid={pwInvalid} errorId={pwErrId} error="Enter a password."
          padRight={64}
          labelAdornment={<PendingBadge>PASSWORD RULES PENDING</PendingBadge>}
          rightAdornment={toggle(pwShown, setPwShown, pwId)}
        />

        <TextField
          id={cfId} label="Confirm password" name="confirm-password" type={cfShown ? 'text' : 'password'} autoComplete="new-password"
          value={cf}
          onChange={(v) => { setCf(v); clearUnavailable(); }}
          invalid={cfInvalid} errorId={cfErrId} error={cf ? 'Passwords don’t match.' : 'Confirm your password.'}
          padRight={64}
          rightAdornment={toggle(cfShown, setCfShown, cfId)}
        />

        <button type="submit" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, height: 44, background: 'var(--amber)', border: '1px solid var(--amber)', borderRadius: 4, font: "600 11px 'JetBrains Mono',monospace", letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--ink)', cursor: 'pointer' }}>
          Create account
        </button>
      </form>

      <div style={{ display: 'flex', justifyContent: 'center', gap: 6, paddingTop: 16, borderTop: '1px solid var(--line)', font: '400 13px Inter,sans-serif', color: 'var(--muted)' }}>
        Already have an account?
        <Link href={routes.login()} style={{ color: 'var(--cool)', textDecoration: 'none', fontWeight: 500 }}>Sign in</Link>
      </div>
    </section>
  );
}
