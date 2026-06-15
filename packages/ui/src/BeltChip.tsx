import type { CSSProperties, HTMLAttributes } from 'react';

/**
 * Obikai BeltChip — renders a rank as a chip. "Belt is a presentation type,
 * not an assumption", so one primitive covers every art:
 *   presentation="belt"   → a colored belt bar. Supports a center band for
 *                           two-tone belts (Taekwondo intermediate ranks, BJJ
 *                           kids belts) and a tip rank-bar carrying stripes/tabs.
 *   presentation="kyu_dan"|"level"|"none" → the label as a neutral rank pill
 *                           (Karate/Judo kyu-dan, numeric levels, belt-less).
 */
export type BeltColor =
  | 'white'
  | 'grey'
  | 'yellow'
  | 'orange'
  | 'green'
  | 'blue'
  | 'purple'
  | 'brown'
  | 'red'
  | 'coral'
  | 'black';

export interface BeltChipProps extends HTMLAttributes<HTMLSpanElement> {
  label: string;
  presentation?: 'belt' | 'kyu_dan' | 'level' | 'none';
  belt?: BeltColor;
  /** Center band color for two-tone belts. A belt key or any CSS color. */
  band?: string | null;
  /** @deprecated alias for `band`. */
  splitWith?: string | null;
  /** Tapes placed on the rank bar (progress within a rank). */
  stripes?: number;
  /** Rank bar: 'auto' (shown when stripes>0) | true | false | a color key. */
  bar?: 'auto' | boolean | string;
}

const BELT_COLORS: Record<string, string> = {
  white: 'var(--belt-white)',
  grey: 'var(--belt-grey)',
  yellow: 'var(--belt-yellow)',
  orange: 'var(--belt-orange)',
  green: 'var(--belt-green)',
  blue: 'var(--belt-blue)',
  purple: 'var(--belt-purple)',
  brown: 'var(--belt-brown)',
  red: 'var(--belt-red)',
  coral: 'var(--belt-coral)',
  black: 'var(--belt-black)',
};

function resolveColor(key?: string | null): string {
  return (key && BELT_COLORS[key]) || key || BELT_COLORS.white!;
}

export function BeltChip({
  label,
  presentation = 'belt',
  belt = 'white',
  band = null,
  splitWith = null,
  stripes = 0,
  bar = 'auto',
  style,
  ...rest
}: BeltChipProps) {
  const bandColor = band || splitWith;

  // Two-tone belts: a solid belt with a center band of a second color running
  // lengthwise (e.g. white-yellow-white). Band = middle third.
  const beltBarBg = bandColor
    ? `linear-gradient(to bottom, ${resolveColor(belt)} 0 34%, ${resolveColor(
        bandColor,
      )} 34% 66%, ${resolveColor(belt)} 66% 100%)`
    : resolveColor(belt);

  // The rank bar (the patch near the belt tip where stripes/tabs are applied).
  // Black on colored belts; traditionally red on a black belt.
  const showBar = bar === 'auto' ? stripes > 0 : Boolean(bar);
  const barColor =
    typeof bar === 'string' && bar !== 'auto'
      ? resolveColor(bar)
      : belt === 'black'
        ? 'var(--belt-red)'
        : 'var(--belt-black)';
  const tapeColor = '#f4f6f8';

  const needsOutline = (belt === 'white' || belt === 'black') && !bandColor;

  if (presentation === 'belt') {
    return (
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.5rem',
          padding: '0.3rem 0.7rem 0.3rem 0.5rem',
          borderRadius: 'var(--radius-pill)',
          background: 'var(--color-surface-2)',
          border: '1px solid var(--color-border)',
          ...style,
        }}
        {...rest}
      >
        {/* The belt graphic */}
        <span
          aria-hidden="true"
          style={{
            position: 'relative',
            width: 38,
            height: 14,
            borderRadius: 3,
            background: beltBarBg,
            border: needsOutline ? '1px solid var(--color-border-2)' : 'none',
            display: 'inline-flex',
            justifyContent: 'flex-end',
            alignItems: 'stretch',
            overflow: 'hidden',
            flexShrink: 0,
          }}
        >
          {/* Rank bar near the tip, carrying stripe tapes */}
          {showBar && (
            <span
              style={{
                position: 'relative',
                marginRight: 4,
                width: Math.max(11, Math.min(stripes, 4) * 4 + 4),
                height: '100%',
                background: barColor,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 2,
                flexShrink: 0,
              }}
            >
              {Array.from({ length: Math.min(stripes, 4) }).map((_, i) => (
                <span
                  // biome-ignore lint/suspicious/noArrayIndexKey: fixed-count decorative tapes
                  key={i}
                  style={{ width: 2, height: '72%', background: tapeColor, flexShrink: 0 }}
                />
              ))}
            </span>
          )}
        </span>

        {/* Label */}
        <span
          style={{
            fontFamily: 'var(--font-sans)',
            fontSize: 'var(--text-sm)',
            fontWeight: 'var(--weight-semibold)',
            color: 'var(--text-body)',
            whiteSpace: 'nowrap',
          }}
        >
          {label}
        </span>
      </span>
    );
  }

  // kyu/dan, level, or belt-less → neutral accent pill
  const pillStyle: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    fontFamily: 'var(--font-sans)',
    fontSize: 'var(--text-2xs)',
    fontWeight: 'var(--weight-bold)',
    textTransform: 'uppercase',
    letterSpacing: 'var(--tracking-caps)',
    padding: '0.2rem 0.6rem',
    borderRadius: 'var(--radius-pill)',
    background: 'var(--color-accent-quiet)',
    color: 'var(--color-accent)',
    ...style,
  };
  return (
    <span style={pillStyle} {...rest}>
      {label}
    </span>
  );
}
