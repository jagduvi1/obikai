import { type ButtonHTMLAttributes, type CSSProperties, type ReactNode, useState } from 'react';

/**
 * Obikai Button — the primary action control.
 * Filled accent by default; secondary (outline) and ghost for lower emphasis;
 * danger borrows the error color for destructive actions.
 */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  iconLeft?: ReactNode;
  iconRight?: ReactNode;
}

const SIZES: Record<ButtonSize, { padding: string; font: string }> = {
  sm: { padding: '0.4rem 0.7rem', font: 'var(--text-sm)' },
  md: { padding: '0.55rem 0.95rem', font: 'var(--text-base)' },
  lg: { padding: '0.7rem 1.3rem', font: 'var(--text-md)' },
};

const VARIANTS: Record<ButtonVariant, CSSProperties> = {
  primary: {
    background: 'var(--color-accent)',
    color: 'var(--color-on-accent)',
    border: '1px solid transparent',
  },
  secondary: {
    background: 'transparent',
    color: 'var(--text-body)',
    border: '1px solid var(--color-border-2)',
  },
  ghost: {
    background: 'transparent',
    color: 'var(--text-body)',
    border: '1px solid transparent',
  },
  danger: {
    background: 'transparent',
    color: 'var(--color-error)',
    border: '1px solid var(--color-error)',
  },
};

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  disabled = false,
  type = 'button',
  iconLeft = null,
  iconRight = null,
  onClick,
  style,
  ...rest
}: ButtonProps) {
  const [hover, setHover] = useState(false);
  const hovered = hover && !disabled;

  const base: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.45rem',
    fontFamily: 'var(--font-sans)',
    fontWeight: 'var(--weight-semibold)',
    fontSize: SIZES[size].font,
    lineHeight: 1.1,
    padding: SIZES[size].padding,
    borderRadius: 'var(--radius-sm)',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1,
    transition: 'background var(--dur-fast) var(--ease-standard), opacity var(--dur-fast)',
    ...VARIANTS[variant],
    ...style,
  };

  const hoverStyle: CSSProperties | null = hovered
    ? variant === 'primary'
      ? { background: 'var(--color-accent-hover)' }
      : { background: 'var(--color-surface-2)' }
    : null;

  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ ...base, ...hoverStyle }}
      {...rest}
    >
      {iconLeft}
      {children}
      {iconRight}
    </button>
  );
}
