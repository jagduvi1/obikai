import type { CSSProperties, HTMLAttributes, MouseEventHandler } from 'react';

/**
 * Obikai ClassCard — one class occurrence as a block: program, time, location,
 * instructor, a capacity meter (booked/total + waitlist), a state, and an
 * optional action button. Used in the weekly timetable and booking lists.
 */
export type ClassState = 'open' | 'booked' | 'waitlisted' | 'full' | 'cancelled' | 'attended';

export interface ClassCapacity {
  booked: number;
  total: number;
  waitlist?: number;
}

export interface ClassCardProps extends Omit<HTMLAttributes<HTMLDivElement>, 'onClick'> {
  program: string;
  time: string;
  location?: string;
  instructor?: string;
  capacity?: ClassCapacity | null;
  state?: ClassState;
  actionLabel?: string | null;
  onAction?: MouseEventHandler<HTMLButtonElement>;
  compact?: boolean;
}

type BadgeKey = 'active' | 'close' | 'frozen' | 'cancelled' | 'ready';

const TONES: Record<ClassState, { border: string; bg: string; badge: [BadgeKey, string] | null }> =
  {
    open: { border: 'var(--color-border)', bg: 'var(--color-surface)', badge: null },
    booked: {
      border: 'var(--color-accent)',
      bg: 'var(--color-accent-quiet)',
      badge: ['active', 'Booked'],
    },
    waitlisted: {
      border: 'var(--color-warning)',
      bg: 'var(--color-surface)',
      badge: ['close', 'Waitlisted'],
    },
    full: { border: 'var(--color-border)', bg: 'var(--color-surface)', badge: ['frozen', 'Full'] },
    cancelled: {
      border: 'var(--color-border)',
      bg: 'var(--color-surface)',
      badge: ['cancelled', 'Cancelled'],
    },
    attended: {
      border: 'var(--color-success)',
      bg: 'var(--color-surface)',
      badge: ['ready', 'Attended'],
    },
  };

const BADGE_TONES: Record<BadgeKey, { bg: string; fg: string }> = {
  active: { bg: 'var(--status-ready-bg)', fg: 'var(--status-ready-fg)' },
  close: { bg: 'var(--status-close-bg)', fg: 'var(--status-close-fg)' },
  frozen: { bg: 'var(--color-surface-2)', fg: 'var(--text-muted)' },
  cancelled: { bg: 'var(--status-notYet-bg)', fg: 'var(--status-notYet-fg)' },
  ready: { bg: 'var(--status-ready-bg)', fg: 'var(--status-ready-fg)' },
};

export function ClassCard({
  program,
  time,
  location,
  instructor,
  capacity = null,
  state = 'open',
  actionLabel = null,
  onAction,
  compact = false,
  style,
  ...rest
}: ClassCardProps) {
  const tone = TONES[state];
  const cancelled = state === 'cancelled';

  const pct = capacity ? Math.min(100, Math.round((capacity.booked / capacity.total) * 100)) : 0;
  const isFull = capacity ? capacity.booked >= capacity.total : false;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: compact ? '0.2rem' : '0.4rem',
        padding: compact ? '0.5rem 0.6rem' : '0.7rem 0.8rem',
        background: tone.bg,
        border: `1px solid ${tone.border}`,
        borderRadius: 'var(--radius-md)',
        opacity: cancelled ? 0.6 : 1,
        ...style,
      }}
      {...rest}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: compact ? 'var(--text-2xs)' : 'var(--text-xs)',
            color: 'var(--color-accent)',
            fontWeight: 'var(--weight-semibold)',
          }}
        >
          {time}
        </span>
        {tone.badge && (
          <span
            style={{
              marginLeft: 'auto',
              fontSize: 'var(--text-2xs)',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: 'var(--tracking-caps)',
              padding: '0.1rem 0.4rem',
              borderRadius: 'var(--radius-pill)',
              background: BADGE_TONES[tone.badge[0]].bg,
              color: BADGE_TONES[tone.badge[0]].fg,
            }}
          >
            {tone.badge[1]}
          </span>
        )}
      </div>

      <span
        style={{
          fontWeight: 'var(--weight-semibold)',
          color: 'var(--text-body)',
          fontSize: compact ? 'var(--text-sm)' : 'var(--text-base)',
          textDecoration: cancelled ? 'line-through' : 'none',
        }}
      >
        {program}
      </span>

      {!compact && (location || instructor) && (
        <span style={{ font: 'var(--font-label)', color: 'var(--text-muted)' }}>
          {[location, instructor].filter(Boolean).join(' · ')}
        </span>
      )}

      {capacity && !cancelled && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', marginTop: '0.1rem' }}>
          <span
            style={{
              flex: 1,
              height: 4,
              borderRadius: 'var(--radius-pill)',
              background: 'var(--color-surface-2)',
              overflow: 'hidden',
              maxWidth: 90,
            }}
          >
            <span
              style={{
                display: 'block',
                height: '100%',
                width: `${pct}%`,
                background: isFull ? 'var(--color-warning)' : 'var(--color-accent)',
              }}
            />
          </span>
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-2xs)',
              color: 'var(--text-muted)',
              whiteSpace: 'nowrap',
            }}
          >
            {capacity.booked}/{capacity.total}
            {capacity.waitlist ? ` · +${capacity.waitlist}` : ''}
          </span>
        </div>
      )}

      {actionLabel && (
        <button
          type="button"
          onClick={onAction}
          style={
            {
              marginTop: compact ? '0.15rem' : '0.4rem',
              alignSelf: compact ? 'flex-start' : 'stretch',
              minHeight: compact ? undefined : 44 /* touch target ≥44px on full cards */,
              background: state === 'booked' ? 'transparent' : 'var(--color-accent)',
              color: state === 'booked' ? 'var(--text-body)' : 'var(--color-on-accent)',
              border: state === 'booked' ? '1px solid var(--color-border-2)' : 'none',
              borderRadius: 'var(--radius-sm)',
              padding: compact ? '0.25rem 0.55rem' : '0.55rem 1rem',
              fontWeight: 'var(--weight-semibold)',
              fontSize: compact ? 'var(--text-2xs)' : 'var(--text-sm)',
              cursor: 'pointer',
            } as CSSProperties
          }
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}
