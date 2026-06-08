import type {
  EmailCapability,
  EmailMessage,
  EmailPort,
  HealthStatus,
} from '@obikai/adapter-contracts';
import type { Locale } from '@obikai/domain';
import { beforeEach, describe, expect, it } from 'vitest';
import { EMAIL_CATALOGS } from '../src/email-catalogs.js';
import {
  type ClassReminder,
  type DunningNotice,
  type InvoiceSummary,
  type NotificationContext,
  NotificationsService,
  type WaiverRequest,
} from '../src/notifications.service.js';

/** Fake EmailPort — records every dispatched message so we can assert what WE rendered (ADR-0003). */
class FakeEmailPort implements EmailPort {
  readonly kind = 'email' as const;
  readonly providerId = 'fake';
  readonly capabilities: ReadonlySet<EmailCapability> = new Set<EmailCapability>(['send']);
  readonly sent: EmailMessage[] = [];

  async init(): Promise<void> {}
  async dispose(): Promise<void> {}
  async health(): Promise<HealthStatus> {
    return { ok: true };
  }
  async send(msg: EmailMessage): Promise<{ providerMessageId: string }> {
    this.sent.push(msg);
    return { providerMessageId: `fake-${this.sent.length}` };
  }
}

const recipient = { email: 'aiko@example.com', name: 'Aiko' };

const ctx = (over: Partial<NotificationContext> = {}): NotificationContext => ({
  name: 'Aiko',
  dojoName: 'Shobukan',
  tenantDefaultLocale: 'en' as Locale,
  ...over,
});

const invoice: InvoiceSummary = {
  number: 'INV-1001',
  currency: 'SEK',
  subtotalMinor: 40_000,
  vatTotalMinor: 10_000,
  totalMinor: 50_000,
  lines: [{ description: 'Monthly membership', quantity: 1, lineTotalMinor: 50_000 }],
};

const dunning: DunningNotice = {
  invoiceNumber: 'INV-1001',
  currency: 'SEK',
  totalMinor: 50_000,
  dunningStage: 2,
};

const waiver: WaiverRequest = { waiverTitle: 'Liability Waiver', memberName: 'Kenji' };

const reminder: ClassReminder = {
  programName: 'Adults BJJ',
  locationName: 'Main Dojo',
  startsAt: '2026-06-10T17:30:00.000Z',
};

describe('NotificationsService', () => {
  let port: FakeEmailPort;
  let svc: NotificationsService;
  beforeEach(() => {
    port = new FakeEmailPort();
    svc = new NotificationsService(port, EMAIL_CATALOGS);
  });

  it('renders an English receipt with subject, recipient and body', async () => {
    const res = await svc.sendReceipt(recipient, 'en', invoice, ctx());
    expect(res.providerMessageId).toBe('fake-1');
    expect(port.sent).toHaveLength(1);
    const msg = port.sent[0]!;
    expect(msg.to).toEqual([recipient]);
    expect(msg.subject).toBe('Your receipt from Shobukan — invoice INV-1001');
    expect(msg.text).toContain('Thank you for your payment');
    expect(msg.text).toContain('INV-1001');
    expect(msg.text).toContain('Monthly membership');
    // SEK money is rendered from minor units (divide by 100) in the viewer locale.
    expect(msg.text).toContain('500');
    expect(msg.html).toContain('<h1>Thank you for your payment</h1>');
    expect(msg.tags).toEqual({ kind: 'receipt', invoice: 'INV-1001' });
  });

  it('renders a Swedish receipt with the localized subject and heading', async () => {
    await svc.sendReceipt(recipient, 'sv', invoice, ctx({ tenantDefaultLocale: 'sv' as Locale }));
    const msg = port.sent[0]!;
    expect(msg.subject).toBe('Ditt kvitto från Shobukan — faktura INV-1001');
    expect(msg.text).toContain('Tack för din betalning');
    expect(msg.html).toContain('<h1>Tack för din betalning</h1>');
  });

  it('renders a dunning notice carrying the invoice number and stage in tags', async () => {
    await svc.sendDunningNotice(recipient, 'en', dunning, ctx());
    const msg = port.sent[0]!;
    expect(msg.subject).toBe('Payment overdue — invoice INV-1001 from Shobukan');
    expect(msg.text).toContain('overdue');
    expect(msg.text).toContain('reminder 2');
    expect(msg.tags).toEqual({ kind: 'dunning', invoice: 'INV-1001', stage: '2' });
  });

  it('renders a Swedish dunning notice', async () => {
    await svc.sendDunningNotice(
      recipient,
      'sv',
      dunning,
      ctx({ tenantDefaultLocale: 'sv' as Locale }),
    );
    const msg = port.sent[0]!;
    expect(msg.subject).toBe('Förfallen betalning — faktura INV-1001 från Shobukan');
    expect(msg.text).toContain('förfallit');
  });

  it('renders a waiver request naming the covered member', async () => {
    await svc.sendWaiverRequest(recipient, 'en', waiver, ctx());
    const msg = port.sent[0]!;
    expect(msg.subject).toBe('Please sign your waiver — Shobukan');
    expect(msg.text).toContain('Liability Waiver');
    expect(msg.text).toContain('Kenji');
    expect(msg.tags).toEqual({ kind: 'waiver' });
  });

  it('renders a Swedish waiver request', async () => {
    await svc.sendWaiverRequest(
      recipient,
      'sv',
      waiver,
      ctx({ tenantDefaultLocale: 'sv' as Locale }),
    );
    const msg = port.sent[0]!;
    expect(msg.subject).toBe('Signera din ansvarsfriskrivning — Shobukan');
    expect(msg.text).toContain('Liability Waiver');
  });

  it('renders a class reminder with a localized formatted time', async () => {
    await svc.sendClassReminder(recipient, 'en', reminder, ctx({ timeZone: 'UTC' }));
    const msg = port.sent[0]!;
    expect(msg.subject).toContain('Adults BJJ');
    expect(msg.text).toContain('Adults BJJ');
    expect(msg.text).toContain('Main Dojo');
    expect(msg.tags).toEqual({ kind: 'reminder' });
  });

  it('renders a Swedish class reminder', async () => {
    await svc.sendClassReminder(
      recipient,
      'sv',
      reminder,
      ctx({ tenantDefaultLocale: 'sv' as Locale, timeZone: 'Europe/Stockholm' }),
    );
    const msg = port.sent[0]!;
    expect(msg.subject).toContain('Påminnelse');
    expect(msg.text).toContain('Vi ses på mattan');
  });

  it('renders a password-reset email with the deep link when a URL is supplied', async () => {
    await svc.sendPasswordReset(
      recipient,
      'en',
      { resetUrl: 'https://app.example/reset?token=abc', token: 'abc', expiresInHours: 1 },
      ctx({ dojoName: 'Obikai' }),
    );
    const msg = port.sent[0]!;
    expect(msg.subject).toBe('Reset your password — Obikai');
    expect(msg.text).toContain('reset your password');
    expect(msg.text).toContain('https://app.example/reset?token=abc');
    expect(msg.tags).toEqual({ kind: 'password-reset' });
  });

  it('falls back to showing the raw token when no reset URL is configured', async () => {
    await svc.sendPasswordReset(
      recipient,
      'en',
      { resetUrl: null, token: 'tok-123', expiresInHours: 2 },
      ctx({ dojoName: 'Obikai' }),
    );
    const msg = port.sent[0]!;
    expect(msg.text).toContain('tok-123');
  });

  it('renders an email-verification message with the deep link and tags it', async () => {
    await svc.sendEmailVerification(
      recipient,
      'en',
      { verifyUrl: 'https://app.example/verify-email?token=xyz', token: 'xyz', expiresInHours: 24 },
      ctx({ dojoName: 'Obikai' }),
    );
    const msg = port.sent[0]!;
    expect(msg.subject).toBe('Confirm your email — Obikai');
    expect(msg.text).toContain('confirm');
    expect(msg.text).toContain('https://app.example/verify-email?token=xyz');
    expect(msg.tags).toEqual({ kind: 'email-verification' });
  });

  it('falls back to the platform default locale for an unsupported locale', async () => {
    await svc.sendReceipt(recipient, 'fi' as Locale, invoice, ctx());
    const msg = port.sent[0]!;
    // 'fi' has no email catalog → English copy is used (DEFAULT_LOCALE fallback).
    expect(msg.subject).toBe('Your receipt from Shobukan — invoice INV-1001');
  });
});
