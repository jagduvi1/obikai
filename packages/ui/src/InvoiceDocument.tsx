import type { CSSProperties, ReactNode } from 'react';

export interface Money {
  amountMinor: number;
  currency: 'SEK' | 'NOK' | 'DKK' | 'EUR';
}
export interface InvoiceLineData {
  description: string;
  quantity: number;
  unitAmount: Money;
  vatPercent: number;
  lineTotal: Money;
}
export interface InvoiceData {
  number: string | null;
  status: 'draft' | 'open' | 'paid' | 'void' | 'uncollectible';
  issuedAt?: string | null;
  dueAt?: string | null;
  paidAt?: string | null;
  period?: { start: string; end: string };
  seller?: { name: string; vatId?: string; address?: string };
  buyer?: { name: string; vatId?: string };
  lines: InvoiceLineData[];
  subtotal: Money;
  vatTotal: Money;
  total: Money;
  reverseCharge?: boolean;
  /** Dunning ladder position; >0 with status "open" renders as Overdue. */
  dunningStage?: number;
}

export interface InvoiceDocumentProps {
  invoice: InvoiceData;
  /** BCP-47 locale for money/date formatting. @default "sv-SE" */
  locale?: string;
  /** Optional footer action, e.g. a "Pay now" or "Mark paid" button. */
  action?: ReactNode;
  /** "dark" = in-app card; "paper" = white artifact for print/PDF/email. @default "dark" */
  variant?: 'dark' | 'paper';
  style?: CSSProperties;
}

/** Format integer-minor-unit Money in a locale (49900 SEK → "499,00 kr"). */
function fmt(m: Money | null | undefined, locale = 'sv-SE'): string {
  if (!m) return '—';
  return new Intl.NumberFormat(locale, { style: 'currency', currency: m.currency }).format(
    m.amountMinor / 100,
  );
}

type BadgeKey = 'draft' | 'open' | 'paid' | 'overdue' | 'void';

const STATUS: Record<string, [BadgeKey, string]> = {
  draft: ['draft', 'Draft'],
  open: ['open', 'Open'],
  paid: ['paid', 'Paid'],
  void: ['void', 'Void'],
  uncollectible: ['void', 'Uncollectible'],
  overdue: ['overdue', 'Overdue'],
};

interface Theme {
  card: string;
  cardBorder: string;
  text: string;
  muted: string;
  faint: string;
  hairline: string;
  error: string;
  badges: Record<BadgeKey, { bg: string; fg: string }>;
}

/* Two surfaces: the in-app dark card, and "paper" — the white artifact that
   gets downloaded, printed and emailed. Paper uses self-contained light values
   so it survives outside the dark token context (e.g. a print stylesheet). */
const THEMES: Record<'dark' | 'paper', Theme> = {
  dark: {
    card: 'var(--color-surface)',
    cardBorder: 'var(--color-border)',
    text: 'var(--text-body)',
    muted: 'var(--text-muted)',
    faint: 'var(--text-disabled)',
    hairline: 'var(--color-border)',
    error: 'var(--color-error)',
    badges: {
      draft: { bg: 'var(--color-surface-2)', fg: 'var(--text-muted)' },
      open: { bg: 'var(--color-accent-quiet)', fg: 'var(--color-accent)' },
      paid: { bg: 'var(--status-ready-bg)', fg: 'var(--status-ready-fg)' },
      overdue: { bg: 'var(--status-close-bg)', fg: 'var(--status-close-fg)' },
      void: { bg: 'var(--status-notYet-bg)', fg: 'var(--status-notYet-fg)' },
    },
  },
  paper: {
    card: '#ffffff',
    cardBorder: '#d8dde3',
    text: '#14181d',
    muted: '#5b6570',
    faint: '#98a1aa',
    hairline: '#e6eaee',
    error: '#b3261e',
    badges: {
      draft: { bg: '#eef1f4', fg: '#5b6570' },
      open: { bg: '#e8f0fc', fg: '#2563c4' },
      paid: { bg: '#e6f4ea', fg: '#1f7a3d' },
      overdue: { bg: '#fdf3df', fg: '#9a6b00' },
      void: { bg: '#fdecea', fg: '#b3261e' },
    },
  },
};

/**
 * Obikai InvoiceDocument — a full VAT invoice: header (number, status, dates),
 * seller/buyer blocks, a line-item table, subtotal/VAT/total, and reverse-charge
 * note. `variant="dark"` is the in-app card; `variant="paper"` is the white
 * print/download artifact.
 */
export function InvoiceDocument({
  invoice,
  locale = 'sv-SE',
  action = null,
  variant = 'dark',
  style,
  ...rest
}: InvoiceDocumentProps) {
  const inv = invoice;
  const T = THEMES[variant];
  const overdue = inv.status === 'open' && (inv.dunningStage ?? 0) > 0;
  const [badgeKey, badgeLabel] = STATUS[overdue ? 'overdue' : inv.status] ?? STATUS.open!;
  const b = T.badges[badgeKey];
  const date = (d?: string | null) => (d ? new Date(d).toLocaleDateString(locale) : '—');

  const dt: CSSProperties = {
    display: 'block',
    fontFamily: 'var(--font-sans)',
    fontSize: 'var(--text-2xs)',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: 'var(--tracking-caps)',
    color: T.faint,
    marginBottom: 3,
  };
  const dd: CSSProperties = { display: 'block', color: T.text, fontSize: 'var(--text-sm)' };
  const th: CSSProperties = {
    padding: '0.5rem 0.6rem',
    borderBottom: `1px solid ${T.hairline}`,
    color: T.muted,
    fontSize: 'var(--text-2xs)',
    textTransform: 'uppercase',
    letterSpacing: 'var(--tracking-caps)',
    fontWeight: 'var(--weight-bold)',
    textAlign: 'center',
  };
  const td: CSSProperties = {
    padding: '0.55rem 0.6rem',
    borderBottom: `1px solid ${T.hairline}`,
    fontSize: 'var(--text-sm)',
    color: T.text,
  };

  return (
    <article
      style={{
        background: T.card,
        border: `1px solid ${T.cardBorder}`,
        borderRadius: 'var(--radius-lg)',
        padding: 'var(--space-6)',
        color: T.text,
        fontFamily: 'var(--font-sans)',
        ...style,
      }}
      {...rest}
    >
      {/* Header */}
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: '1rem',
          flexWrap: 'wrap',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <h3
              style={{
                margin: 0,
                fontSize: 'var(--text-lg)',
                fontWeight: 'var(--weight-semibold)',
                color: T.text,
              }}
            >
              Invoice
            </h3>
            <span style={{ fontFamily: 'var(--font-mono)', color: T.muted }}>
              {inv.number || 'DRAFT'}
            </span>
          </div>
          {inv.period && (
            <span style={{ fontSize: 'var(--text-xs)', color: T.muted }}>
              Service period {date(inv.period.start)} – {date(inv.period.end)}
            </span>
          )}
        </div>
        <span
          style={{
            fontSize: 'var(--text-2xs)',
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: 'var(--tracking-caps)',
            padding: '0.25rem 0.6rem',
            borderRadius: 'var(--radius-pill)',
            background: b.bg,
            color: b.fg,
          }}
        >
          {badgeLabel}
        </span>
      </header>

      {/* Parties + dates */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
          gap: '1rem',
          margin: '1.25rem 0',
          paddingBottom: '1.25rem',
          borderBottom: `1px solid ${T.hairline}`,
        }}
      >
        {inv.seller && (
          <Party
            label="From"
            name={inv.seller.name}
            vatId={inv.seller.vatId}
            extra={inv.seller.address}
            T={T}
            dt={dt}
            dd={dd}
          />
        )}
        {inv.buyer && (
          <Party
            label="Bill to"
            name={inv.buyer.name}
            vatId={inv.buyer.vatId}
            T={T}
            dt={dt}
            dd={dd}
          />
        )}
        <div>
          <span style={dt}>Issued</span>
          <span style={dd}>{date(inv.issuedAt)}</span>
        </div>
        <div>
          <span style={dt}>Due</span>
          <span style={{ ...dd, color: overdue ? T.error : T.text }}>{date(inv.dueAt)}</span>
        </div>
      </div>

      {/* Lines */}
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={{ ...th, textAlign: 'left' }}>Description</th>
            <th style={th}>Qty</th>
            <th style={{ ...th, textAlign: 'right' }}>Unit</th>
            <th style={th}>VAT</th>
            <th style={{ ...th, textAlign: 'right' }}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {inv.lines.map((l, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: invoice lines are positional and stable
            <tr key={i}>
              <td style={{ ...td, textAlign: 'left' }}>{l.description}</td>
              <td style={{ ...td, textAlign: 'center', fontFamily: 'var(--font-mono)' }}>
                {l.quantity}
              </td>
              <td style={{ ...td, textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                {fmt(l.unitAmount, locale)}
              </td>
              <td style={{ ...td, textAlign: 'center', color: T.muted }}>{l.vatPercent}%</td>
              <td style={{ ...td, textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                {fmt(l.lineTotal, locale)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Totals */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1rem' }}>
        <div style={{ minWidth: 240, display: 'grid', gap: '0.35rem' }}>
          <TotalRow label="Subtotal" value={fmt(inv.subtotal, locale)} T={T} />
          <TotalRow
            label={inv.reverseCharge ? 'VAT (reverse charge)' : 'VAT'}
            value={fmt(inv.vatTotal, locale)}
            T={T}
            muted
          />
          <div style={{ height: 1, background: T.hairline, margin: '0.3rem 0' }} />
          <TotalRow label="Total" value={fmt(inv.total, locale)} T={T} strong />
        </div>
      </div>

      {inv.reverseCharge && (
        <p
          style={{ fontSize: 'var(--text-xs)', color: T.muted, marginTop: '1rem', marginBottom: 0 }}
        >
          Reverse charge — VAT to be accounted for by the recipient (Art. 196 VAT Directive).
        </p>
      )}

      {action && (
        <div style={{ marginTop: '1.25rem', display: 'flex', justifyContent: 'flex-end' }}>
          {action}
        </div>
      )}
    </article>
  );
}

interface PartyProps {
  label: string;
  name: string;
  vatId?: string | undefined;
  extra?: string | undefined;
  T: Theme;
  dt: CSSProperties;
  dd: CSSProperties;
}
function Party({ label, name, vatId, extra, T, dt, dd }: PartyProps) {
  return (
    <div>
      <span style={dt}>{label}</span>
      <span style={{ ...dd, fontWeight: 'var(--weight-semibold)' }}>{name}</span>
      {extra && (
        <span style={{ fontSize: 'var(--text-xs)', color: T.muted, display: 'block' }}>
          {extra}
        </span>
      )}
      {vatId && (
        <span
          style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-2xs)', color: T.faint }}
        >
          {vatId}
        </span>
      )}
    </div>
  );
}

interface TotalRowProps {
  label: string;
  value: string;
  T: Theme;
  strong?: boolean;
  muted?: boolean;
}
function TotalRow({ label, value, strong = false, muted = false, T }: TotalRowProps) {
  const color = muted ? T.muted : T.text;
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem' }}>
      <span
        style={{
          fontSize: strong ? 'var(--text-md)' : 'var(--text-sm)',
          fontWeight: strong ? 'var(--weight-semibold)' : 'var(--weight-regular)',
          color,
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontWeight: strong ? 'var(--weight-bold)' : 'var(--weight-regular)',
          fontSize: strong ? 'var(--text-md)' : 'var(--text-sm)',
          color,
        }}
      >
        {value}
      </span>
    </div>
  );
}
