// SHARED FORM PRIMITIVES — small, generic presentational form pieces for the public
// auth pages (B4 Login now; B5 Sign Up later can reuse them). DB-free, no hooks, so
// they compose inside a client form. They reuse the Phase A design system tokens and
// the global :focus-visible amber ring — no separate form palette. Labels are always
// associated with their input (htmlFor/id); errors are wired via aria-describedby and
// convey meaning with text + an icon, never colour alone.

import type { CSSProperties, ReactNode } from 'react';

const LABEL: CSSProperties = { font: "400 10px 'JetBrains Mono',monospace", letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--muted)' };

/** An inline field error: a "!" glyph + message in the danger colour, referenced by
 *  the input's aria-describedby. */
export function FieldError({ id, children }: { id: string; children: ReactNode }) {
  return (
    <span id={id} style={{ display: 'flex', gap: 6, alignItems: 'center', font: '400 12px Inter,sans-serif', color: 'var(--risk)' }}>
      <span aria-hidden style={{ font: "700 11px 'JetBrains Mono',monospace" }}>!</span>{children}
    </span>
  );
}

export interface TextFieldProps {
  id: string;
  label: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  autoComplete?: string;
  inputMode?: 'text' | 'email' | 'numeric' | 'tel' | 'url' | 'none' | 'search' | 'decimal';
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  errorId?: string;
  error?: ReactNode;
  /** Rendered top-right of the label row (e.g. a "Forgot password?" link). */
  labelAdornment?: ReactNode;
  /** Rendered absolutely inside the field, right-aligned (e.g. a show/hide button). */
  rightAdornment?: ReactNode;
  /** Extra right padding to clear a rightAdornment. */
  padRight?: number;
}

/** A labelled text input with an optional inline error and right adornment. The
 *  amber focus ring comes from the global :focus-visible rule; the border only turns
 *  red when the field is invalid, so focus and error are visually distinct. */
export function TextField(props: TextFieldProps) {
  const { id, label, name, value, onChange, type = 'text', autoComplete, inputMode, placeholder,
    disabled, invalid, errorId, error, labelAdornment, rightAdornment, padRight } = props;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <label htmlFor={id} style={LABEL}>{label}</label>
        {labelAdornment}
      </div>
      <div style={{ position: 'relative' }}>
        <input
          id={id}
          type={type}
          name={name}
          autoComplete={autoComplete}
          inputMode={inputMode}
          placeholder={placeholder}
          value={value}
          disabled={disabled}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid && errorId ? errorId : undefined}
          onChange={(e) => onChange(e.target.value)}
          style={{
            height: 44, width: '100%', boxSizing: 'border-box',
            padding: `0 ${padRight ?? 12}px 0 12px`,
            background: disabled ? 'var(--panel)' : 'var(--raised)',
            border: `1px solid ${invalid ? 'var(--risk)' : 'var(--line)'}`,
            borderRadius: 4,
            font: '400 15px Inter,sans-serif',
            color: disabled ? 'var(--faint)' : 'var(--text)',
          }}
        />
        {rightAdornment}
      </div>
      {invalid && error && errorId ? <FieldError id={errorId}>{error}</FieldError> : null}
    </div>
  );
}
