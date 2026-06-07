/**
 * EU VAT-number FORMAT validation (ADR-0025). Pure + isomorphic (no I/O, no node deps) — the
 * syntactic, offline first line of defence before any network check. It tells you a VAT id is
 * well-formed for its member state; it does NOT tell you the number is registered — only a live VIES
 * lookup (the VatValidationPort) can confirm existence.
 *
 * Coverage: the 27 EU member states VIES covers. Each key is the VAT PREFIX, which is the ISO-3166
 * code EXCEPT Greece, which uses `EL` (from "Hellas"), not `GR`. Deliberately NOT here: GB (left the
 * EU/VIES), NO/CH/IS/LI (not EU) — their VAT systems validate nationally, not via VIES.
 */

/** Per-country pattern for the number PART (after the 2-letter prefix), anchored + uppercased. */
export interface VatFormat {
  readonly pattern: RegExp;
  /** A well-formed example, including the prefix. */
  readonly example: string;
}

export const EU_VAT_FORMATS: Readonly<Record<string, VatFormat>> = {
  AT: { pattern: /^U\d{8}$/, example: 'ATU12345678' },
  BE: { pattern: /^[01]\d{9}$/, example: 'BE0123456789' },
  BG: { pattern: /^\d{9,10}$/, example: 'BG123456789' },
  HR: { pattern: /^\d{11}$/, example: 'HR12345678901' },
  CY: { pattern: /^\d{8}[A-Z]$/, example: 'CY12345678L' },
  CZ: { pattern: /^\d{8,10}$/, example: 'CZ12345678' },
  DK: { pattern: /^\d{8}$/, example: 'DK12345678' },
  EE: { pattern: /^\d{9}$/, example: 'EE123456789' },
  FI: { pattern: /^\d{8}$/, example: 'FI12345678' },
  FR: { pattern: /^[0-9A-HJ-NP-Z]{2}\d{9}$/, example: 'FR40303265045' },
  DE: { pattern: /^\d{9}$/, example: 'DE123456789' },
  EL: { pattern: /^\d{9}$/, example: 'EL123456789' },
  HU: { pattern: /^\d{8}$/, example: 'HU12345678' },
  IE: {
    pattern: /^(?:\d{7}[A-W]|[0-9A-Z]\d{5}[0-9A-Z][A-W]|\d{7}[A-W][AH])$/,
    example: 'IE1234567FA',
  },
  IT: { pattern: /^\d{11}$/, example: 'IT12345678901' },
  LV: { pattern: /^\d{11}$/, example: 'LV12345678901' },
  LT: { pattern: /^(?:\d{9}|\d{12})$/, example: 'LT123456789' },
  LU: { pattern: /^\d{8}$/, example: 'LU12345678' },
  MT: { pattern: /^\d{8}$/, example: 'MT12345678' },
  NL: { pattern: /^\d{9}B\d{2}$/, example: 'NL123456789B01' },
  PL: { pattern: /^\d{10}$/, example: 'PL1234567890' },
  PT: { pattern: /^\d{9}$/, example: 'PT123456789' },
  RO: { pattern: /^\d{2,10}$/, example: 'RO1234567890' },
  SK: { pattern: /^\d{10}$/, example: 'SK1234567890' },
  SI: { pattern: /^[1-9]\d{7}$/, example: 'SI12345678' },
  ES: { pattern: /^(?:[A-Z]\d{7}[0-9A-Z]|\d{8}[A-Z])$/, example: 'ESX1234567L' },
  SE: { pattern: /^\d{10}01$/, example: 'SE123456789001' },
} as const;

/** Country codes VIES covers, i.e. the supported VAT prefixes. */
export const VIES_COUNTRY_CODES = Object.keys(EU_VAT_FORMATS);

export type VatFormatReason = 'ok' | 'too-short' | 'unsupported-country' | 'bad-format';

export interface VatFormatResult {
  /** True only when the country is VIES-covered AND the number matches that country's pattern. */
  readonly ok: boolean;
  /** The 2-letter prefix (uppercased) if one could be extracted, else null. */
  readonly countryCode: string | null;
  /** The number part after the prefix (normalized), else null. */
  readonly number: string | null;
  /** The full normalized id (countryCode + number) when extractable, else null. */
  readonly normalized: string | null;
  readonly reason: VatFormatReason;
}

/** Strip spaces/dots/hyphens and uppercase — VAT ids are written with varied separators. */
export function normalizeVatId(raw: string): string {
  return raw.replace(/[\s.\-_/]/g, '').toUpperCase();
}

/**
 * Validate a full VAT id (prefix + number) structurally. Offline + deterministic. `ok` means
 * "well-formed for a VIES country" — NOT "registered"; confirm existence via the VatValidationPort.
 */
export function validateVatFormat(raw: string): VatFormatResult {
  const normalized = normalizeVatId(raw ?? '');
  if (normalized.length < 3) {
    return { ok: false, countryCode: null, number: null, normalized: null, reason: 'too-short' };
  }
  const countryCode = normalized.slice(0, 2);
  const number = normalized.slice(2);
  const format = EU_VAT_FORMATS[countryCode];
  if (!format) {
    return { ok: false, countryCode, number, normalized, reason: 'unsupported-country' };
  }
  if (!format.pattern.test(number)) {
    return { ok: false, countryCode, number, normalized, reason: 'bad-format' };
  }
  return { ok: true, countryCode, number, normalized, reason: 'ok' };
}
