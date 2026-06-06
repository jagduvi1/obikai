import type { Invoice, Money, TenantBillingProfile } from '@obikai/domain';
import { PDFDocument, type PDFFont, type PDFPage, StandardFonts, rgb } from 'pdf-lib';

/**
 * Invoice PDF rendering (ADR-0013/0018). A framework-free, deterministic renderer: it takes the
 * issued invoice plus the seller billing profile (ADR-0018) and the buyer name, and lays out a
 * compliant invoice — seller legal/VAT identity, invoice number + dates, bill-to, line items with a
 * VAT breakdown, totals, the reverse-charge note when applicable, and payment/footer text. It does
 * NO data access and NO authorization (the controller does both before calling), so it is trivially
 * unit-testable. `pdf-lib` is pure JS (no native deps), keeping the self-host footprint small.
 */

export interface InvoicePdfInput {
  readonly invoice: Invoice;
  readonly seller: TenantBillingProfile | null;
  readonly buyerName: string | null;
}

/** Minor units → "1234.56 SEK". Deterministic (no Intl) so output is byte-stable across hosts. */
export function formatMoney(money: Money): string {
  const sign = money.amountMinor < 0 ? '-' : '';
  const abs = Math.abs(money.amountMinor);
  const major = Math.floor(abs / 100);
  const cents = String(abs % 100).padStart(2, '0');
  return `${sign}${major}.${cents} ${money.currency}`;
}

/** ISO timestamp/date → "YYYY-MM-DD" (or "—" when absent). */
export function formatDate(iso: string | null): string {
  return iso ? iso.slice(0, 10) : '—';
}

/** The seller address block as ordered, non-empty lines. */
export function sellerLines(seller: TenantBillingProfile | null): string[] {
  if (!seller) return ['Seller details not configured'];
  const cityLine = [seller.postalCode, seller.city].filter(Boolean).join(' ');
  return [
    seller.legalName,
    seller.addressLine1,
    seller.addressLine2,
    cityLine || null,
    seller.country,
    seller.vatId ? `VAT: ${seller.vatId}` : null,
    seller.registrationNumber ? `Reg. no: ${seller.registrationNumber}` : null,
    seller.email,
  ].filter((l): l is string => typeof l === 'string' && l.trim() !== '');
}

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 50;
const RIGHT = A4[0] - MARGIN;
// Right edges of the numeric columns in the line-item table.
const COL = { qty: 360, unit: 440, vat: 495, amount: RIGHT };

/** A downward-advancing text cursor over a single page. */
class Cursor {
  y: number;
  constructor(
    private readonly page: PDFPage,
    private readonly font: PDFFont,
    private readonly bold: PDFFont,
    startY: number,
  ) {
    this.y = startY;
  }
  text(s: string, opts: { x?: number; size?: number; bold?: boolean } = {}): void {
    const size = opts.size ?? 10;
    this.page.drawText(s, {
      x: opts.x ?? MARGIN,
      y: this.y,
      size,
      font: opts.bold ? this.bold : this.font,
      color: rgb(0.1, 0.12, 0.15),
    });
  }
  /** Draw right-aligned at right-edge `xRight` on the current line. */
  right(s: string, xRight: number, opts: { size?: number; bold?: boolean } = {}): void {
    const size = opts.size ?? 10;
    const f = opts.bold ? this.bold : this.font;
    const w = f.widthOfTextAtSize(s, size);
    this.page.drawText(s, { x: xRight - w, y: this.y, size, font: f, color: rgb(0.1, 0.12, 0.15) });
  }
  move(dy: number): void {
    this.y -= dy;
  }
  rule(): void {
    this.page.drawLine({
      start: { x: MARGIN, y: this.y },
      end: { x: RIGHT, y: this.y },
      thickness: 0.5,
      color: rgb(0.8, 0.82, 0.85),
    });
  }
}

/** Truncate a description so it never collides with the numeric columns. */
function clip(text: string, font: PDFFont, size: number, maxWidth: number): string {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  let s = text;
  while (s.length > 1 && font.widthOfTextAtSize(`${s}…`, size) > maxWidth) s = s.slice(0, -1);
  return `${s}…`;
}

export async function renderInvoicePdf(input: InvoicePdfInput): Promise<Uint8Array> {
  const { invoice, seller, buyerName } = input;
  const doc = await PDFDocument.create();
  doc.setTitle(`Invoice ${invoice.number ?? invoice.id}`);
  const page = doc.addPage(A4);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const c = new Cursor(page, font, bold, A4[1] - MARGIN);

  // ── Seller block ───────────────────────────────────────────────────────────
  const lines = sellerLines(seller);
  c.text(lines[0] ?? '', { size: 16, bold: true });
  c.move(18);
  for (const line of lines.slice(1)) {
    c.text(line, { size: 9 });
    c.move(12);
  }

  // ── Invoice title + meta (right-aligned) ─────────────────────────────────────
  c.move(10);
  const titleY = c.y;
  c.right('INVOICE', RIGHT, { size: 20, bold: true });
  c.move(26);
  c.right(`No. ${invoice.number ?? '(draft)'}`, RIGHT, { size: 10, bold: true });
  c.move(13);
  c.right(`Issued: ${formatDate(invoice.issuedAt)}`, RIGHT, { size: 9 });
  c.move(12);
  c.right(`Due: ${formatDate(invoice.dueAt)}`, RIGHT, { size: 9 });
  c.move(12);
  c.right(`Status: ${invoice.status}`, RIGHT, { size: 9 });

  // ── Bill-to (left, aligned under the seller block) ───────────────────────────
  c.y = Math.min(titleY, c.y) - 24;
  c.text('Bill to', { size: 9, bold: true });
  c.move(13);
  c.text(buyerName ?? invoice.memberId, { size: 10 });
  c.move(12);
  if (invoice.buyerVatId) {
    c.text(`VAT: ${invoice.buyerVatId}`, { size: 9 });
    c.move(12);
  }
  if (invoice.periodStart && invoice.periodEnd) {
    c.text(`Period: ${formatDate(invoice.periodStart)} – ${formatDate(invoice.periodEnd)}`, {
      size: 9,
    });
    c.move(12);
  }

  // ── Line-item table ──────────────────────────────────────────────────────────
  c.move(14);
  c.text('Description', { bold: true, size: 9 });
  c.right('Qty', COL.qty, { bold: true, size: 9 });
  c.right('Unit', COL.unit, { bold: true, size: 9 });
  c.right('VAT %', COL.vat, { bold: true, size: 9 });
  c.right('Amount', COL.amount, { bold: true, size: 9 });
  c.move(6);
  c.rule();
  c.move(14);

  for (const line of invoice.lines) {
    c.text(clip(line.description, font, 10, COL.qty - MARGIN - 50), { size: 10 });
    c.right(String(line.quantity), COL.qty);
    c.right(formatMoney(line.unitAmount), COL.unit);
    c.right(invoice.reverseCharge ? '—' : String(line.vatPercent), COL.vat);
    c.right(formatMoney(line.lineTotal), COL.amount);
    c.move(16);
  }

  // ── Totals ───────────────────────────────────────────────────────────────────
  c.move(2);
  c.rule();
  c.move(16);
  c.right('Subtotal', COL.vat);
  c.right(formatMoney(invoice.subtotal), COL.amount);
  c.move(14);
  c.right('VAT', COL.vat);
  c.right(formatMoney(invoice.vatTotal), COL.amount);
  c.move(14);
  c.right('Total', COL.vat, { bold: true });
  c.right(formatMoney(invoice.total), COL.amount, { bold: true });
  c.move(22);

  // ── Reverse-charge note (legally required when VAT is shifted to the buyer) ───
  if (invoice.reverseCharge) {
    c.text('Reverse charge — VAT to be accounted for by the recipient (Art. 196 VAT Directive).', {
      size: 9,
      bold: true,
    });
    c.move(16);
  }

  // ── Payment details + footer ─────────────────────────────────────────────────
  if (seller?.paymentDetails) {
    c.text('Payment', { size: 9, bold: true });
    c.move(12);
    for (const ln of seller.paymentDetails.split(/\r?\n/)) {
      c.text(ln, { size: 9 });
      c.move(12);
    }
    c.move(4);
  }
  if (seller?.footerNote) {
    for (const ln of seller.footerNote.split(/\r?\n/)) {
      c.text(ln, { size: 8 });
      c.move(11);
    }
  }

  return doc.save();
}
