import type { AdapterContext, Logger, SecretRef } from '@obikai/adapter-contracts';
import type { Money } from '@obikai/domain';
import { describe, expect, it } from 'vitest';
import { ManualPaymentsProvider } from './index.js';

const noopLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

function makeCtx(now = new Date('2026-06-06T12:00:00.000Z')): AdapterContext {
  return {
    logger: noopLogger,
    readSecret: async (_ref: SecretRef) => '',
    clock: () => now,
  };
}

const amount: Money = { amountMinor: 25000, currency: 'SEK' };

describe('ManualPaymentsProvider', () => {
  it('creates charges in processing, awaiting offline confirmation', async () => {
    const provider = new ManualPaymentsProvider(makeCtx());
    const { charge, action } = await provider.createCharge({
      amount,
      idempotencyKey: 'idem-1',
      invoiceId: 'inv-1',
    });

    expect(charge.status).toBe('processing');
    expect(charge.providerId).toBe('manual');
    expect(action).toEqual({ type: 'none' });
  });

  it('markPaid yields the canonical charge.succeeded webhook event', async () => {
    const provider = new ManualPaymentsProvider(makeCtx());
    const { charge } = await provider.createCharge({ amount, idempotencyKey: 'idem-2' });

    const webhook = provider.markPaid(charge.id);

    expect(webhook.providerId).toBe('manual');
    expect(webhook.connectedAccountId).toBeNull();
    expect(webhook.event.type).toBe('charge.succeeded');
    if (webhook.event.type === 'charge.succeeded') {
      expect(webhook.event.providerChargeRef).toBe(charge.providerChargeRef);
      expect(webhook.event.amount).toEqual(amount);
    }
  });

  it('markPaid honours a partial paid amount override', async () => {
    const provider = new ManualPaymentsProvider(makeCtx());
    const { charge } = await provider.createCharge({ amount, idempotencyKey: 'idem-3' });

    const partial: Money = { amountMinor: 10000, currency: 'SEK' };
    const webhook = provider.markPaid(charge.id, partial);

    if (webhook.event.type === 'charge.succeeded') {
      expect(webhook.event.amount).toEqual(partial);
    }
  });

  it('markPaid throws for an unknown charge', async () => {
    const provider = new ManualPaymentsProvider(makeCtx());
    expect(() => provider.markPaid('does-not-exist')).toThrow();
  });

  it('setupMandate returns an immediately-active mandate with no client action', async () => {
    const provider = new ManualPaymentsProvider(makeCtx());
    const { mandate, action } = await provider.setupMandate({
      method: 'autogiro',
      payerRef: 'member-1',
      tenantId: 'tenant-1',
    });

    expect(mandate.status).toBe('active');
    expect(mandate.providerId).toBe('manual');
    expect(action).toEqual({ type: 'none' });
  });
});
