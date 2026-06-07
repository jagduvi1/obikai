import { describe, expect, it } from 'vitest';
import {
  EU_VAT_FORMATS,
  VIES_COUNTRY_CODES,
  normalizeVatId,
  validateVatFormat,
} from '../src/vat.js';

describe('normalizeVatId', () => {
  it('strips separators and uppercases', () => {
    expect(normalizeVatId('se 556677-8899 01')).toBe('SE556677889901');
    expect(normalizeVatId('ATU1234.5678')).toBe('ATU12345678');
  });
});

describe('validateVatFormat — every country example is well-formed', () => {
  it('accepts the canonical example for all 27 VIES countries', () => {
    expect(VIES_COUNTRY_CODES).toHaveLength(27);
    for (const [code, fmt] of Object.entries(EU_VAT_FORMATS)) {
      const r = validateVatFormat(fmt.example);
      expect(r.ok, `${code} example ${fmt.example}`).toBe(true);
      expect(r.countryCode).toBe(code);
    }
  });

  it('accepts separators/lowercase around a valid id', () => {
    const r = validateVatFormat(' se 5566778890 01 ');
    expect(r.ok).toBe(true);
    expect(r.normalized).toBe('SE556677889001');
    expect(r.number).toBe('556677889001');
  });
});

describe('validateVatFormat — rejections', () => {
  it('rejects a non-EU / non-VIES country (GB, NO, GR-not-EL)', () => {
    expect(validateVatFormat('GB123456789').reason).toBe('unsupported-country');
    expect(validateVatFormat('NO999999999MVA').reason).toBe('unsupported-country');
    // Greece is EL in VIES, not GR — a common mistake.
    expect(validateVatFormat('GR123456789').reason).toBe('unsupported-country');
    expect(validateVatFormat('EL123456789').ok).toBe(true);
  });

  it('rejects a wrong-length / malformed number for a known country', () => {
    expect(validateVatFormat('SE12345').reason).toBe('bad-format'); // too few digits
    expect(validateVatFormat('DE12345678').reason).toBe('bad-format'); // DE needs 9 digits
    expect(validateVatFormat('ATX12345678').reason).toBe('bad-format'); // AT needs literal 'U'
  });

  it('rejects too-short input', () => {
    expect(validateVatFormat('S').reason).toBe('too-short');
    expect(validateVatFormat('').reason).toBe('too-short');
  });

  it('does not confuse a valid pattern across countries (FR key excludes O/I)', () => {
    expect(validateVatFormat('FROI303265045').reason).toBe('bad-format');
    expect(validateVatFormat('FR40303265045').ok).toBe(true);
  });
});
