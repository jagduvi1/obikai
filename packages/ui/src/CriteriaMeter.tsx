import type { HTMLAttributes } from 'react';

/**
 * Obikai CriteriaMeter — one grading criterion row from the rank engine's
 * eligibility result: a satisfied check, the criterion label, and either a
 * boolean state or a progress bar (current / target). `advisory` criteria are
 * marked as non-blocking.
 */
export interface CriteriaMeterProps extends HTMLAttributes<HTMLDivElement> {
  label: string;
  satisfied?: boolean;
  current?: number;
  target?: number;
  unit?: string;
  advisory?: boolean;
}

export function CriteriaMeter({
  label,
  satisfied = false,
  current,
  target,
  unit = 'boolean',
  advisory = false,
  style,
  ...rest
}: CriteriaMeterProps) {
  const isBoolean = unit === 'boolean' || target == null;
  const pct = isBoolean
    ? satisfied
      ? 100
      : 0
    : Math.min(100, Math.round(((current ?? 0) / (target || 1)) * 100));

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.6rem',
        padding: '0.4rem 0',
        ...style,
      }}
      {...rest}
    >
      <span
        aria-hidden="true"
        style={{
          flex: 'none',
          width: 18,
          height: 18,
          borderRadius: 'var(--radius-pill)',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 11,
          fontWeight: 700,
          background: satisfied ? 'var(--status-ready-bg)' : 'var(--color-surface-2)',
          color: satisfied ? 'var(--status-ready-fg)' : 'var(--text-disabled)',
          border: satisfied ? 'none' : '1px solid var(--color-border-2)',
        }}
      >
        {satisfied ? '✓' : ''}
      </span>

      <span
        style={{
          font: 'var(--font-body)',
          fontSize: 'var(--text-sm)',
          color: 'var(--text-body)',
          minWidth: 0,
        }}
      >
        {label}
        {advisory && (
          <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-xs)' }}>
            {' '}
            (advisory)
          </span>
        )}
      </span>

      {!isBoolean && (
        <span
          style={{
            marginLeft: 'auto',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.5rem',
          }}
        >
          <span
            style={{
              width: 120,
              height: 6,
              borderRadius: 'var(--radius-pill)',
              background: 'var(--color-surface-2)',
              overflow: 'hidden',
              display: 'inline-block',
            }}
          >
            <span
              style={{
                display: 'block',
                height: '100%',
                width: `${pct}%`,
                background: satisfied ? 'var(--color-success)' : 'var(--color-accent)',
                borderRadius: 'var(--radius-pill)',
                transition: 'width var(--dur-slow) var(--ease-out)',
              }}
            />
          </span>
          <span
            style={{
              font: 'var(--font-label)',
              color: 'var(--text-muted)',
              fontFamily: 'var(--font-mono)',
              whiteSpace: 'nowrap',
            }}
          >
            {current}/{target} {unit}
          </span>
        </span>
      )}
    </div>
  );
}
