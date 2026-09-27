'use client';
// LOGIN FORM (B4) — the interactive sign-in card. Client component.
//
// What is REAL here: the form UI and client-side validation (email format,
// password required), show/hide password, and accessible labelling/errors.
//
// What is NOT real: authentication. There is no auth backend in this app, so the
// form performs NO network request, stores NO credentials (state lives only in
// memory and is never persisted, logged, or put in the URL), and creates NO
// session. On a valid submit it shows an honest "not available yet" message — never
// a fabricated success or a fake "incorrect password" error. The design's own
// "AUTH IMPLEMENTATION PENDING" annotation is preserved to say so plainly.

import { useId, useState } from 'react';
import { TextField } from '@/components/v2/form';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function LoginForm() {
  const uid = useId();
  const emailId = `${uid}-email`, pwId = `${uid}-pw`, emailErrId = `${uid}-ee`, pwErrId = `${uid}-pe`;

  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [shown, setShown] = useState(false);
  const [touched, setTouched] = useState(false);
  const [unavailable, setUnavailable] = useState(false);

  const emailOk = EMAIL_RE.test(email);
  const pwOk = pw.length > 0;
  const emailInvalid = touched && !emailOk;
  const pwInvalid = touched && !pwOk;

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!emailOk || !pwOk) { setTouched(true); return; }
    // Fields are valid, but there is no authentication backend — report that
    // honestly. No request is made and nothing is stored.
    setUnavailable(true);
  }

  return (
    <section aria-labelledby={`${uid}-h`} className="panel" style={{ width: '100%', maxWidth: 400, padding: 32, display: 'flex', flexDirection: 'column', gap: 20, boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <span style={{ font: "400 10px 'JetBrains Mono',monospace", letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--muted)' }}>Sign in</span>
          <span style={{ font: "600 8.5px 'JetBrains Mono',monospace", letterSpacing: '.08em', color: 'var(--warn)', border: '1px dashed var(--warn)', borderRadius: 3, padding: '1px 4px' }}>AUTH IMPLEMENTATION PENDING</span>
        </div>
        <h1 id={`${uid}-h`} style={{ margin: 0, font: '700 22px/1.2 Inter,sans-serif', color: 'var(--text)' }}>Sign in to PitchTerminal</h1>
      </div>

      {unavailable && (
        <div role="alert" style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '10px 12px', border: '1px solid var(--warn)', borderRadius: 4, background: 'color-mix(in srgb, var(--warn) 10%, transparent)' }}>
          <span aria-hidden style={{ flex: 'none', width: 18, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--warn)', borderRadius: 3, font: "700 11px 'JetBrains Mono',monospace", color: 'var(--warn)' }}>!</span>
          <span style={{ font: '400 13px/1.45 Inter,sans-serif', color: 'var(--text)' }}>Sign-in isn’t available yet — accounts open in a later release. You can explore PitchTerminal without an account.</span>
        </div>
      )}

      <form onSubmit={onSubmit} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <TextField
          id={emailId} label="Email" name="email" type="email" autoComplete="email" inputMode="email"
          placeholder="name@example.com"
          value={email}
          onChange={(v) => { setEmail(v); if (unavailable) setUnavailable(false); }}
          invalid={emailInvalid} errorId={emailErrId}
          error={email ? 'Enter a complete email address.' : 'Enter your email address.'}
        />

        <TextField
          id={pwId} label="Password" name="password" type={shown ? 'text' : 'password'} autoComplete="current-password"
          value={pw}
          onChange={(v) => { setPw(v); if (unavailable) setUnavailable(false); }}
          invalid={pwInvalid} errorId={pwErrId} error="Enter your password."
          padRight={64}
          labelAdornment={
            // Password reset is not part of the current (absent) auth infrastructure,
            // so this is non-interactive until it exists.
            <span title="Password reset is not available yet" style={{ font: '500 12px Inter,sans-serif', color: 'var(--faint)', cursor: 'default' }}>Forgot password?</span>
          }
          rightAdornment={
            <button type="button" onClick={() => setShown((s) => !s)} aria-pressed={shown} aria-controls={pwId}
              style={{ position: 'absolute', right: 4, top: 4, height: 36, padding: '0 10px', background: 'transparent', border: 0, borderRadius: 4, font: "500 10px 'JetBrains Mono',monospace", letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--muted)', cursor: 'pointer' }}>
              {shown ? 'Hide' : 'Show'}
            </button>
          }
        />

        <label style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 32, font: '400 13px Inter,sans-serif', color: 'var(--text-secondary)', cursor: 'pointer' }}>
          <input type="checkbox" name="remember" style={{ width: 16, height: 16, margin: 0, accentColor: 'var(--amber)' }} />
          Keep me signed in
        </label>

        <button type="submit" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, height: 44, background: 'var(--amber)', border: '1px solid var(--amber)', borderRadius: 4, font: "600 11px 'JetBrains Mono',monospace", letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--ink)', cursor: 'pointer' }}>
          Sign in
        </button>
      </form>

      <div style={{ display: 'flex', justifyContent: 'center', gap: 6, paddingTop: 16, borderTop: '1px solid var(--line)', font: '400 13px Inter,sans-serif', color: 'var(--muted)' }}>
        Don’t have an account?
        {/* Sign up is B5 — not built yet, so non-interactive until that phase. */}
        <span title="Account sign-up opens in a later release" style={{ color: 'var(--faint)', fontWeight: 500, cursor: 'default' }}>Sign up</span>
      </div>
    </section>
  );
}
