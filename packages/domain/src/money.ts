import { z } from 'zod';

/** Per-tenant currencies (invariant 6). Currency is a property of the money, not the viewer. */
export const CURRENCIES = ['SEK', 'NOK', 'DKK', 'EUR'] as const;
export type Currency = (typeof CURRENCIES)[number];

export const currencySchema = z.enum(CURRENCIES);

/** Money is always integer minor units (öre/cents) to avoid floating-point money bugs. */
export interface Money {
  readonly amountMinor: number;
  readonly currency: Currency;
}

export const moneySchema: z.ZodType<Money> = z.object({
  amountMinor: z.number().int(),
  currency: currencySchema,
});

export const money = (amountMinor: number, currency: Currency): Money => ({
  amountMinor,
  currency,
});

export class CurrencyMismatchError extends Error {
  constructor(a: Currency, b: Currency) {
    super(`Currency mismatch: ${a} vs ${b}`);
    this.name = 'CurrencyMismatchError';
  }
}

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) throw new CurrencyMismatchError(a.currency, b.currency);
}

export function addMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.amountMinor + b.amountMinor, a.currency);
}

export function subtractMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.amountMinor - b.amountMinor, a.currency);
}
