import { type InputHTMLAttributes, useId, useState } from 'react';

/**
 * Obikai TextField — a labelled input with the product's stacked field layout.
 * Label sits above; optional hint + error below. Works for text/email/password/etc.
 */
export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  error?: string;
}

export function TextField({
  label,
  type = 'text',
  hint = '',
  error = '',
  disabled = false,
  id,
  style,
  ...rest
}: TextFieldProps) {
  const autoId = useId();
  const inputId = id || autoId;
  const [focus, setFocus] = useState(false);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', ...style }}>
      {label && (
        <label htmlFor={inputId} style={{ font: 'var(--font-label)', color: 'var(--text-muted)' }}>
          {label}
        </label>
      )}
      <input
        id={inputId}
        type={type}
        disabled={disabled}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        style={{
          padding: '0.55rem 0.65rem',
          fontFamily: 'var(--font-sans)',
          fontSize: 'var(--text-base)',
          color: 'var(--text-body)',
          background: 'var(--color-bg)',
          border: `1px solid ${
            error ? 'var(--color-error)' : focus ? 'var(--color-accent)' : 'var(--color-border)'
          }`,
          borderRadius: 'var(--radius-sm)',
          outline: 'none',
          boxShadow: focus && !error ? '0 0 0 3px var(--color-accent-quiet)' : 'none',
          opacity: disabled ? 0.5 : 1,
          transition: 'border-color var(--dur-fast), box-shadow var(--dur-fast)',
        }}
        {...rest}
      />
      {error ? (
        <span style={{ font: 'var(--font-label)', color: 'var(--color-error)' }}>{error}</span>
      ) : hint ? (
        <span style={{ font: 'var(--font-label)', color: 'var(--text-muted)' }}>{hint}</span>
      ) : null}
    </div>
  );
}
