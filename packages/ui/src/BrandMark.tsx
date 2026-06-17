import type { CSSProperties } from 'react';

/**
 * Obikai brand mark — a geometric obi (belt) knot: a horizontal blue belt bar
 * crossed by a white/blue vertical knot on the dark app square. The product's
 * only logo glyph. Inlined (no asset pipeline) so it renders everywhere,
 * including in tests. Pair with the wordmark via {@link BrandLockup}.
 */
export interface BrandMarkProps {
  size?: number;
  title?: string;
  style?: CSSProperties;
}

export function BrandMark({ size = 26, title = 'Obikai', style }: BrandMarkProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 512 512"
      width={size}
      height={size}
      role="img"
      aria-label={title}
      style={{ display: 'block', flexShrink: 0, ...style }}
    >
      <rect width="512" height="512" rx="96" fill="#0f1216" />
      <rect x="56" y="232" width="400" height="48" rx="10" fill="#4f9dff" />
      <rect x="208" y="176" width="96" height="160" rx="14" fill="#e8ecf1" />
      <rect x="224" y="176" width="64" height="160" rx="10" fill="#4f9dff" />
    </svg>
  );
}

/**
 * The brand lockup: mark + "Obikai" wordmark (Zen Kaku Gothic New 900).
 * Used in app headers and the auth/login surfaces.
 */
export interface BrandLockupProps {
  /** Mark size in px; the wordmark scales with the surrounding font size. */
  markSize?: number;
  /** Wordmark font-size token. @default "var(--text-md)" */
  wordmarkSize?: string;
  /** Hide the wordmark, showing the mark alone. */
  markOnly?: boolean;
  style?: CSSProperties;
}

export function BrandLockup({
  markSize = 26,
  wordmarkSize = 'var(--text-md)',
  markOnly = false,
  style,
}: BrandLockupProps) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.55rem',
        flexShrink: 0,
        ...style,
      }}
    >
      <BrandMark size={markSize} />
      {!markOnly && (
        <span
          style={{
            fontFamily: 'var(--font-display-family)',
            fontWeight: 900,
            fontSize: wordmarkSize,
            color: 'var(--text-body)',
            letterSpacing: 'var(--tracking-tight)',
          }}
        >
          Obikai
        </span>
      )}
    </span>
  );
}
