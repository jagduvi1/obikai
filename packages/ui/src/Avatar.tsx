import type { HTMLAttributes } from 'react';

/**
 * Obikai Avatar — initials on a surface tint, optionally ringed in a belt color.
 * Used in rosters, member lists and the subject switcher. No photo uploads in
 * the product, so initials are the default.
 */
export type AvatarBelt =
  | 'white'
  | 'yellow'
  | 'orange'
  | 'green'
  | 'blue'
  | 'purple'
  | 'brown'
  | 'black';

export interface AvatarProps extends HTMLAttributes<HTMLSpanElement> {
  name?: string;
  size?: number;
  belt?: AvatarBelt | null;
}

const BELT_COLORS: Record<AvatarBelt, string> = {
  white: 'var(--belt-white)',
  yellow: 'var(--belt-yellow)',
  orange: 'var(--belt-orange)',
  green: 'var(--belt-green)',
  blue: 'var(--belt-blue)',
  purple: 'var(--belt-purple)',
  brown: 'var(--belt-brown)',
  black: 'var(--belt-black)',
};

export function Avatar({ name = '', size = 36, belt = null, style, ...rest }: AvatarProps) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');

  const ring = belt ? BELT_COLORS[belt] : 'var(--color-border-2)';

  return (
    <span
      aria-label={name}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        flex: 'none',
        borderRadius: 'var(--radius-pill)',
        background: 'var(--color-surface-2)',
        color: 'var(--text-body)',
        border: `2px solid ${ring}`,
        fontFamily: 'var(--font-sans)',
        fontWeight: 'var(--weight-semibold)',
        fontSize: Math.round(size * 0.4),
        letterSpacing: '0.01em',
        ...style,
      }}
      {...rest}
    >
      {initials || '–'}
    </span>
  );
}
