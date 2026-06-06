import type { Invoice, Money, TenantBillingProfile } from '@obikai/domain';
import { describe, expect, it } from 'vitest';
import { formatDate, formatMoney, renderInvoicePdf, sellerLines } from './invoice-pdf.js';

const money = (amountMinor: number, currency = 'SEK'): Money =>
  ({ amountMinor, currency }) as Money;

const seller: TenantBillingProfile = {
  id: 'bp1' as TenantBillingProfile['id'],
  tenantId: 't1' as TenantBillingProfile['tenantId'],
  legalName: 'Aikido Stockholm AB',
  vatId: 'SE556677889901',
  registrationNumber: '556677-8899',
  addressLine1: 'Mästersamuelsgatan 1',
  addressLine2: null,
  postalCode: '111 44',
  city: 'Stockholm',
  country: 'SE',
  email: 'billing@aikido.example',
  paymentDetails: 'Bankgiro: 123-4567',
  footerNote: 'Thank you for training with us.',
  createdAt: '2026-06-06T00:00:00.000Z',
  updatedAt: '2026-06-06T00:00:00.000Z',
};

const invoice = {
  id: 'inv1',
  tenantId: 't1',
  number: 'OBK-2026-000123',
  memberId: 'm1',
  householdId: null,
  enrollmentId: 'e1',
  periodStart: '2026-06-01',
  periodEnd: '2026-06-30',
  status: 'open',
  currency: 'SEK',
  lines: [
    {
      description: 'Adult monthly membership',
      quantity: 1,
      unitAmount: money(80000),
      vatPercent: 25,
      vatAmount: money(20000),
      lineTotal: money(100000),
    },
  ],
  subtotal: money(80000),
  vatTotal: money(20000),
  total: money(100000),
  reverseCharge: false,
  sellerVatId: 'SE556677889901',
  buyerVatId: null,
  issuedAt: '2026-06-01T08:00:00.000Z',
  dueAt: '2026-06-15T00:00:00.000Z',
  paidAt: null,
  dunningStage: 0,
  nextRetryAt: null,
  createdAt: '2026-06-01T08:00:00.000Z',
  updatedAt: '2026-06-01T08:00:00.000Z',
} as Invoice;

describe('formatMoney', () => {
  it('formats minor units to major.cc with currency', () => {
    expect(formatMoney(money(123456))).toBe('1234.56 SEK');
    expect(formatMoney(money(5, 'EUR'))).toBe('0.05 EUR');
    expect(formatMoney(money(0, 'NOK'))).toBe('0.00 NOK');
    expect(formatMoney(money(-1, 'DKK'))).toBe('-0.01 DKK');
  });
});

describe('formatDate', () => {
  it('takes the date part, and em-dashes a null', () => {
    expect(formatDate('2026-06-06T10:00:00.000Z')).toBe('2026-06-06');
    expect(formatDate(null)).toBe('—');
  });
});

describe('sellerLines', () => {
  it('placeholders an unconfigured seller', () => {
    expect(sellerLines(null)).toEqual(['Seller details not configured']);
  });
  it('orders the configured seller block and drops blanks', () => {
    const lines = sellerLines(seller);
    expect(lines[0]).toBe('Aikido Stockholm AB');
    expect(lines).toContain('VAT: SE556677889901');
    expect(lines).toContain('Reg. no: 556677-8899');
    expect(lines).toContain('111 44 Stockholm');
    // addressLine2 was null → not present.
    expect(lines).not.toContain('');
  });
});

describe('renderInvoicePdf', () => {
  it('produces a non-empty PDF document', async () => {
    const bytes = await renderInvoicePdf({ invoice, seller, buyerName: 'Ada Lovelace' });
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(800);
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
  });

  it('renders even when the seller profile is missing', async () => {
    const bytes = await renderInvoicePdf({ invoice, seller: null, buyerName: null });
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
  });
});
