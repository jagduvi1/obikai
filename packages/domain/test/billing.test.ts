import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  type Currency,
  addMonthsUTC,
  buildInvoiceLine,
  computeBillingPeriod,
  computeVat,
  intervalMonths,
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

describe('intervalMonths', () => {
  it('maps each interval to a month count', () => {
    expect(intervalMonths('monthly')).toBe(1);
    expect(intervalMonths('quarterly')).toBe(3);
    expect(intervalMonths('yearly')).toBe(12);
    expect(intervalMonths('none')).toBe(0);
  });
});

describe('addMonthsUTC', () => {
  it('adds whole months', () => {
    expect(addMonthsUTC('2026-01-15', 1)).toBe('2026-02-15');
    expect(addMonthsUTC('2026-01-15', 3)).toBe('2026-04-15');
    expect(addMonthsUTC('2026-01-15', 12)).toBe('2027-01-15');
  });
  it('clamps to the last day of a shorter target month', () => {
    expect(addMonthsUTC('2026-01-31', 1)).toBe('2026-02-28'); // 2026 not leap
    expect(addMonthsUTC('2024-01-31', 1)).toBe('2024-02-29'); // 2024 leap
    expect(addMonthsUTC('2026-01-31', 3)).toBe('2026-04-30');
  });
  it('rolls over year boundaries', () => {
    expect(addMonthsUTC('2026-11-30', 3)).toBe('2027-02-28');
    expect(addMonthsUTC('2026-12-15', 1)).toBe('2027-01-15');
  });
  it('adding 12 months always lands on the same month/day (or clamped) one year on', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2000, max: 2100 }),
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 1, max: 28 }), // <=28 avoids month-length ambiguity
        (y, m, d) => {
          const date = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
          expect(addMonthsUTC(date, 12)).toBe(
            `${y + 1}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
          );
        },
      ),
    );
  });
});

describe('computeBillingPeriod', () => {
  it('returns the first period from startDate when never billed', () => {
    expect(computeBillingPeriod('monthly', '2026-01-01', null, '2026-01-05')).toEqual({
      periodStart: '2026-01-01',
      periodEnd: '2026-02-01',
    });
  });
  it('continues from currentPeriodEnd for subsequent periods', () => {
    expect(computeBillingPeriod('monthly', '2026-01-01', '2026-02-01', '2026-02-10')).toEqual({
      periodStart: '2026-02-01',
      periodEnd: '2026-03-01',
    });
  });
  it('quarterly/yearly advance by 3/12 months', () => {
    expect(computeBillingPeriod('quarterly', '2026-01-01', null, '2026-01-01')?.periodEnd).toBe(
      '2026-04-01',
    );
    expect(computeBillingPeriod('yearly', '2026-01-01', null, '2026-06-01')?.periodEnd).toBe(
      '2027-01-01',
    );
  });
  it('is null when the next period has not started yet (bills in advance, not ahead)', () => {
    expect(computeBillingPeriod('monthly', '2026-05-01', null, '2026-04-30')).toBeNull();
    expect(computeBillingPeriod('monthly', '2026-01-01', '2026-03-01', '2026-02-15')).toBeNull();
  });
  it('is null for non-recurring intervals', () => {
    expect(computeBillingPeriod('none', '2026-01-01', null, '2026-12-31')).toBeNull();
  });
  it('chained periods tile with no gaps or overlaps', () => {
    // Walk a year of monthly periods: each periodEnd is the next periodStart.
    let end: string | null = null;
    let prevEnd = '2026-01-01';
    for (let i = 0; i < 12; i++) {
      const p = computeBillingPeriod('monthly', '2026-01-01', end, '2030-01-01');
      expect(p).not.toBeNull();
      if (!p) break;
      expect(p.periodStart).toBe(prevEnd); // contiguous: no gap, no overlap
      prevEnd = p.periodEnd;
      end = p.periodEnd;
    }
    expect(end).toBe('2027-01-01'); // 12 monthly steps from Jan 1 → next Jan 1
  });
});
