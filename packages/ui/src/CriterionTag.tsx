import type { HTMLAttributes } from 'react';

/**
 * Obikai CriterionTag — renders one promotion criterion as a compact chip.
 * Required criteria gate promotion; advisory criteria are nudges (dashed, muted).
 * Pass `met` to show satisfied/unsatisfied state in a viewer or progress context.
 */
export interface CriterionTagProps extends HTMLAttributes<HTMLSpanElement> {
  label: string;
  value?: string | number | null;
  enforcement?: 'required' | 'advisory';
  met?: boolean | null;
}

export function CriterionTag({
  label,
  value,
  enforcement = 'required',
  met = null,
  style,
  ...rest
}: CriterionTagProps) {
  const advisory = enforcement === 'advisory';

  let dot: { bg: string; fg: string; glyph: string };
  if (met === true)
    dot = { bg: 'var(--status-ready-bg)', fg: 'var(--status-ready-fg)', glyph: '✓' };
  else if (met === false)
    dot = { bg: 'var(--color-surface-2)', fg: 'var(--text-disabled)', glyph: '○' };
  else
    dot = {
      bg: advisory ? 'transparent' : 'var(--color-accent-quiet)',
      fg: advisory ? 'var(--text-muted)' : 'var(--color-accent)',
      glyph: '',
    };

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.4rem',
        padding: '0.25rem 0.6rem',
        borderRadius: 'var(--radius-pill)',
        border: `1px ${advisory ? 'dashed' : 'solid'} var(--color-border-2)`,
        background: 'var(--color-surface)',
        whiteSpace: 'nowrap',
        ...style,
      }}
      {...rest}
    >
      {dot.glyph ? (
        <span
          aria-hidden="true"
          style={{
            width: 15,
            height: 15,
            borderRadius: 'var(--radius-pill)',
            background: dot.bg,
            color: dot.fg,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 10,
            fontWeight: 700,
            flexShrink: 0,
          }}
        >
          {dot.glyph}
        </span>
      ) : (
        <span
          aria-hidden="true"
          style={{ width: 7, height: 7, borderRadius: '50%', background: dot.fg, flexShrink: 0 }}
        />
      )}
      <span style={{ font: 'var(--font-label)', color: 'var(--text-body)' }}>{label}</span>
      {value != null && (
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--text-xs)',
            color: 'var(--text-muted)',
          }}
        >
          {value}
        </span>
      )}
      {advisory && (
        <span
          style={{
            fontSize: 'var(--text-2xs)',
            color: 'var(--text-disabled)',
            textTransform: 'uppercase',
            letterSpacing: 'var(--tracking-caps)',
          }}
        >
          advisory
        </span>
      )}
    </span>
  );
}
