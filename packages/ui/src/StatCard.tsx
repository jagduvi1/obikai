import type { HTMLAttributes, ReactNode } from 'react';

/**
 * Obikai StatCard — a dashboard metric tile (label + big value).
 * `alert` raises an attention border (e.g. members at risk, payments to recover).
 */
export interface StatCardProps extends HTMLAttributes<HTMLDivElement> {
  label: ReactNode;
  value: ReactNode;
  alert?: boolean;
  hint?: ReactNode;
}

export function StatCard({
  label,
  value,
  alert = false,
  hint = '',
  style,
  ...rest
}: StatCardProps) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '0.3rem',
        padding: 'var(--space-4) var(--space-5)',
        background: 'var(--color-surface)',
        border: `1px solid ${alert ? 'var(--color-error)' : 'var(--color-border)'}`,
        borderRadius: 'var(--radius-lg)',
        minWidth: '160px',
        ...style,
      }}
      {...rest}
    >
      <span
        style={{
          fontFamily: 'var(--font-sans)',
          fontSize: 'var(--text-lg)',
          fontWeight: 'var(--weight-bold)',
          color: alert ? 'var(--color-error)' : 'var(--text-body)',
          lineHeight: 1.1,
        }}
      >
        {value}
      </span>
      <span style={{ font: 'var(--font-label)', color: 'var(--text-muted)' }}>{label}</span>
      {hint && (
        <span
          style={{
            font: 'var(--font-overline)',
            color: 'var(--text-disabled)',
            textTransform: 'uppercase',
            letterSpacing: 'var(--tracking-caps)',
          }}
        >
          {hint}
        </span>
      )}
    </div>
  );
}
