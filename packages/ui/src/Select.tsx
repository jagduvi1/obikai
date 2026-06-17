import { type ReactNode, type SelectHTMLAttributes, useId, useState } from 'react';

/**
 * Obikai Select — a labelled native dropdown matching the field styling.
 * Pass `options` as {value,label}[] or use children <option>s.
 */
export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  options?: SelectOption[] | null;
  children?: ReactNode;
}

export function Select({
  label,
  options = null,
  children,
  disabled = false,
  id,
  style,
  ...rest
}: SelectProps) {
  const autoId = useId();
  const selId = id || autoId;
  const [focus, setFocus] = useState(false);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', ...style }}>
      {label && (
        <label htmlFor={selId} style={{ font: 'var(--font-label)', color: 'var(--text-muted)' }}>
          {label}
        </label>
      )}
      <select
        id={selId}
        disabled={disabled}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        style={{
          padding: '0.55rem 0.65rem',
          fontFamily: 'var(--font-sans)',
          fontSize: 'var(--text-base)',
          color: 'var(--text-body)',
          background: 'var(--color-bg)',
          border: `1px solid ${focus ? 'var(--color-accent)' : 'var(--color-border)'}`,
          borderRadius: 'var(--radius-sm)',
          outline: 'none',
          boxShadow: focus ? '0 0 0 3px var(--color-accent-quiet)' : 'none',
          opacity: disabled ? 0.5 : 1,
          cursor: disabled ? 'not-allowed' : 'pointer',
          transition: 'border-color var(--dur-fast), box-shadow var(--dur-fast)',
        }}
        {...rest}
      >
        {options
          ? options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))
          : children}
      </select>
    </div>
  );
}
