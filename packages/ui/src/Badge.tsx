import type { HTMLAttributes } from 'react';

/**
 * Obikai Badge — a pill label. `tone` selects a semantic color pair:
 * status tones (ready/close/notYet) for grading verdicts, lifecycle tones
 * (lead/trial/active/frozen/cancelled) for members, plus neutral/accent.
 */
export type BadgeTone =
  | 'neutral'
  | 'accent'
  | 'ready'
  | 'close'
  | 'notYet'
  | 'lead'
  | 'trial'
  | 'active'
  | 'frozen'
  | 'cancelled';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
}

// The 12px bold badge label must clear WCAG 2.1 AA (4.5:1; CLAUDE.md invariant 6).
// `accent`/`trial` use the lighter accent (--color-accent-hover) on the quiet fill:
// the base --color-accent (#4f9dff) on --color-accent-quiet is only ~4.2:1, while the
// hover shade clears 4.5:1. Deliberate deviation from the handoff Badge — AA overrides.
const TONES: Record<BadgeTone, { bg: string; fg: string }> = {
  neutral: { bg: 'var(--color-surface-2)', fg: 'var(--text-muted)' },
  accent: { bg: 'var(--color-accent-quiet)', fg: 'var(--color-accent-hover)' },
  ready: { bg: 'var(--status-ready-bg)', fg: 'var(--status-ready-fg)' },
  close: { bg: 'var(--status-close-bg)', fg: 'var(--status-close-fg)' },
  notYet: { bg: 'var(--status-notYet-bg)', fg: 'var(--status-notYet-fg)' },
  lead: { bg: 'var(--color-platform-quiet)', fg: 'var(--member-lead)' },
  trial: { bg: 'var(--color-accent-quiet)', fg: 'var(--color-accent-hover)' },
  active: { bg: 'var(--color-success-quiet)', fg: 'var(--member-active)' },
  frozen: { bg: 'var(--color-surface-2)', fg: 'var(--member-frozen)' },
  cancelled: { bg: 'var(--color-error-quiet)', fg: 'var(--member-cancelled)' },
};

export function Badge({ children, tone = 'neutral', style, ...rest }: BadgeProps) {
  const c = TONES[tone];
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.3rem',
        fontFamily: 'var(--font-sans)',
        fontSize: 'var(--text-2xs)',
        fontWeight: 'var(--weight-bold)',
        textTransform: 'uppercase',
        letterSpacing: 'var(--tracking-caps)',
        padding: '0.18rem 0.55rem',
        borderRadius: 'var(--radius-pill)',
        background: c.bg,
        color: c.fg,
        ...style,
      }}
      {...rest}
    >
      {children}
    </span>
  );
}
