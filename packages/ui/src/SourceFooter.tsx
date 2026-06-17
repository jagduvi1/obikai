import type { CSSProperties } from 'react';

/**
 * The AGPL §13 "source available" offer (scope §2): every networked Obikai UI links to its
 * corresponding source. A quiet, muted footer line — present on all three SPAs.
 */
export interface SourceFooterProps {
  /** Repository URL hosting the corresponding source. */
  href?: string;
  style?: CSSProperties;
}

export function SourceFooter({
  href = 'https://github.com/jagduvi1/obikai',
  style,
}: SourceFooterProps) {
  return (
    <footer
      style={{
        padding: 'var(--space-4) var(--space-5)',
        borderTop: '1px solid var(--color-border)',
        textAlign: 'center',
        ...style,
      }}
    >
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        style={{ font: 'var(--font-label)', color: 'var(--text-muted)' }}
      >
        Obikai is free, open-source software (AGPL-3.0) — source available
      </a>
    </footer>
  );
}
