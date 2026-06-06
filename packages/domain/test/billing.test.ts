import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  type Currency,
  buildInvoiceLine,
  computeVat,
  invoiceTotals,
  money,
  prorateByDays,
} from '../src/index.js';

const CUR: Currency = 'SEK';

describe('computeVat', () => {
  it('computes standard Nordic rates exactly', () => {
    expect(computeVat(money(10000, CUR), 25).amountMinor).toBe(2500);
    expect(computeVat(money(10000, CUR), 12).amountMinor).toBe(1200);
    expect(computeVat(money(10000, CUR), 6).amountMinor).toBe(600);
    expect(computeVat(money(12345, CUR), 0).amountMinor).toBe(0);
  });
  it('rounds half away from zero', () => {
    // 333 * 25% = 83.25 → 83;  2 * 25% = 0.5 → 1
    expect(computeVat(money(333, CUR), 25).amountMinor).toBe(83);
    expect(computeVat(money(2, CUR), 25).amountMinor).toBe(1);
  });
});

describe('invoiceTotals', () => {
  it('sums lines into subtotal/vat/total', () => {
    const lines = [
      buildInvoiceLine('Adults BJJ', 1, money(50000, CUR), 25),
      buildInvoiceLine('Gi', 2, money(80000, CUR), 25),
    ];
    const t = invoiceTotals(lines, CUR);
    expect(t.subtotal.amountMinor).toBe(50000 + 160000);
    expect(t.vatTotal.amountMinor).toBe(12500 + 40000);
    expect(t.total.amountMinor).toBe(t.subtotal.amountMinor + t.vatTotal.amountMinor);
  });
  it('reverse charge zeroes VAT on a line', () => {
    const line = buildInvoiceLine('SaaS fee', 1, money(100000, CUR), 25, true);
    expect(line.vatAmount.amountMinor).toBe(0);
    expect(line.vatPercent).toBe(0);
    expect(line.lineTotal.amountMinor).toBe(100000);
  });
});

describe('prorateByDays — money is conserved (property)', () => {
  it('prorate(x,n,k) + prorate(x,n,n-k) === x', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10_000_000 }),
        fc.integer({ min: 1, max: 366 }),
        fc.integer({ min: 0, max: 366 }),
        (amountMinor, totalDays, k) => {
          const kk = Math.min(k, totalDays);
          const a = prorateByDays(money(amountMinor, CUR), totalDays, kk).amountMinor;
          const b = prorateByDays(money(amountMinor, CUR), totalDays, totalDays - kk).amountMinor;
          // Rounding can split a unit, so allow at most 1 minor-unit of rounding slack.
          expect(Math.abs(a + b - amountMinor)).toBeLessThanOrEqual(1);
        },
      ),
    );
  });
  it('clamps remaining days to [0, total]', () => {
    expect(prorateByDays(money(3000, CUR), 30, 45).amountMinor).toBe(3000);
    expect(prorateByDays(money(3000, CUR), 30, -5).amountMinor).toBe(0);
    expect(prorateByDays(money(3000, CUR), 0, 10).amountMinor).toBe(0);
  });
});
