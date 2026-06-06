import type { EmailMessage, EmailPort, EmailRecipient } from '@obikai/adapter-contracts';
import { type Currency, DEFAULT_LOCALE, type Locale } from '@obikai/domain';
import { type Catalog, makeFormatters, t } from '@obikai/i18n';

/**
 * NotificationsService — transactional email for the platform (scope §4.8, §5). It is deliberately
 * framework-free (no Nest imports) so it unit-tests against a fake EmailPort with explicit locales.
 *
 * ADR-0003: WE render subject/text/html in OUR i18n layer from `email`-namespace catalog keys; the
 * EmailPort provider only transports the already-rendered message — no provider templating feature
 * is depended on. Money/date are formatted with the viewer's locale and the tenant's currency
 * (invariant 6) via `makeFormatters`.
 */

/** A line on a receipt, already reduced to display-ready integer minor units. */
export interface InvoiceSummaryLine {
  readonly description: string;
  readonly quantity: number;
  readonly lineTotalMinor: number;
}

/** The minimal invoice view a receipt needs — no persistence type leaks into the email layer. */
export interface InvoiceSummary {
  readonly number: string;
  readonly currency: Currency;
  readonly subtotalMinor: number;
  readonly vatTotalMinor: number;
  readonly totalMinor: number;
  readonly lines: readonly InvoiceSummaryLine[];
}

/** Inputs for a dunning (overdue) notice. `dunningStage` is the ladder position (1 = first reminder). */
export interface DunningNotice {
  readonly invoiceNumber: string;
  readonly currency: Currency;
  readonly totalMinor: number;
  readonly dunningStage: number;
}

/** Inputs for a waiver-signature request. `memberName` is who the waiver covers (may be a minor). */
export interface WaiverRequest {
  readonly waiverTitle: string;
  readonly memberName: string;
}

/** Inputs for an upcoming-class reminder. `startsAt` is an ISO-8601 instant. */
export interface ClassReminder {
  readonly programName: string;
  readonly locationName: string;
  readonly startsAt: string;
}

/** Common envelope fields the caller supplies for every message. */
export interface NotificationContext {
  /** The recipient's display name, interpolated into the greeting. */
  readonly name: string;
  /** The dojo/tenant display name, interpolated into subjects and the signature. */
  readonly dojoName: string;
  /** The tenant's authoring default locale — drives money formatting and copy fallback. */
  readonly tenantDefaultLocale: Locale;
  /** IANA timezone for rendering class times, e.g. 'Europe/Stockholm'. */
  readonly timeZone?: string;
}

interface RenderedEmail {
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

/** Escape the four HTML-significant characters so interpolated copy is safe in the html body. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export class NotificationsService {
  constructor(
    private readonly email: EmailPort,
    private readonly catalogs: Partial<Record<Locale, Catalog>>,
  ) {}

  /** Resolve the email catalog for a viewer locale, falling back to the platform default ('en'). */
  private catalogFor(locale: Locale): Catalog {
    return this.catalogs[locale] ?? this.catalogs[DEFAULT_LOCALE] ?? {};
  }

  /** Build {subject,text,html} from a subject key and pre-rendered body paragraphs. */
  private compose(
    catalog: Catalog,
    subjectKey: string,
    subjectVars: Record<string, string | number>,
    heading: string,
    paragraphs: readonly string[],
    dojoName: string,
  ): RenderedEmail {
    const subject = t(catalog, subjectKey, subjectVars);
    const signature = t(catalog, 'email.signature', { dojo: dojoName });
    const textBody = [heading, '', ...paragraphs, '', signature].join('\n');
    const htmlParagraphs = paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join('\n');
    const html =
      `<h1>${escapeHtml(heading)}</h1>\n${htmlParagraphs}\n` + `<p>${escapeHtml(signature)}</p>`;
    return { subject, text: textBody, html };
  }

  private async dispatch(
    to: EmailRecipient,
    rendered: RenderedEmail,
    tags: Readonly<Record<string, string>>,
  ): Promise<{ providerMessageId: string }> {
    const message: EmailMessage = {
      to: [to],
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
      tags,
    };
    return this.email.send(message);
  }

  /** Send a paid-invoice receipt (scope §5). */
  async sendReceipt(
    to: EmailRecipient,
    locale: Locale,
    invoice: InvoiceSummary,
    ctx: NotificationContext,
  ): Promise<{ providerMessageId: string }> {
    const catalog = this.catalogFor(locale);
    const fmt = makeFormatters({
      locale,
      currency: invoice.currency,
      ...(ctx.timeZone !== undefined ? { timeZone: ctx.timeZone } : {}),
    });
    const total = fmt.money(invoice.totalMinor);
    const heading = t(catalog, 'email.receipt.heading');
    const body = t(catalog, 'email.receipt.body', {
      name: ctx.name,
      number: invoice.number,
      total,
    });
    const linesHeader = t(catalog, 'email.receipt.lines.header');
    const lineRows = invoice.lines.map((line) =>
      t(catalog, 'email.receipt.line', {
        description: line.description,
        quantity: line.quantity,
        lineTotal: fmt.money(line.lineTotalMinor),
      }),
    );
    const totals = t(catalog, 'email.receipt.totals', {
      subtotal: fmt.money(invoice.subtotalMinor),
      vatTotal: fmt.money(invoice.vatTotalMinor),
      total,
    });
    const rendered = this.compose(
      catalog,
      'email.receipt.subject',
      { dojo: ctx.dojoName, number: invoice.number },
      heading,
      [body, linesHeader, ...lineRows, totals],
      ctx.dojoName,
    );
    return this.dispatch(to, rendered, { kind: 'receipt', invoice: invoice.number });
  }

  /** Send a dunning (overdue invoice) notice (scope §5, billing dunning ladder ADR-0013). */
  async sendDunningNotice(
    to: EmailRecipient,
    locale: Locale,
    notice: DunningNotice,
    ctx: NotificationContext,
  ): Promise<{ providerMessageId: string }> {
    const catalog = this.catalogFor(locale);
    const fmt = makeFormatters({ locale, currency: notice.currency });
    const total = fmt.money(notice.totalMinor);
    const heading = t(catalog, 'email.dunning.heading');
    const body = t(catalog, 'email.dunning.body', {
      name: ctx.name,
      number: notice.invoiceNumber,
      total,
      stage: notice.dunningStage,
    });
    const action = t(catalog, 'email.dunning.action');
    const rendered = this.compose(
      catalog,
      'email.dunning.subject',
      { dojo: ctx.dojoName, number: notice.invoiceNumber },
      heading,
      [body, action],
      ctx.dojoName,
    );
    return this.dispatch(to, rendered, {
      kind: 'dunning',
      invoice: notice.invoiceNumber,
      stage: String(notice.dunningStage),
    });
  }

  /** Send a waiver-signature request (scope §4.10, §5). */
  async sendWaiverRequest(
    to: EmailRecipient,
    locale: Locale,
    request: WaiverRequest,
    ctx: NotificationContext,
  ): Promise<{ providerMessageId: string }> {
    const catalog = this.catalogFor(locale);
    const heading = t(catalog, 'email.waiver.heading');
    const body = t(catalog, 'email.waiver.body', {
      name: ctx.name,
      title: request.waiverTitle,
      memberName: request.memberName,
    });
    const action = t(catalog, 'email.waiver.action');
    const rendered = this.compose(
      catalog,
      'email.waiver.subject',
      { dojo: ctx.dojoName },
      heading,
      [body, action],
      ctx.dojoName,
    );
    return this.dispatch(to, rendered, { kind: 'waiver' });
  }

  /** Send an upcoming-class reminder (scope §4.3, §5). */
  async sendClassReminder(
    to: EmailRecipient,
    locale: Locale,
    reminder: ClassReminder,
    ctx: NotificationContext,
  ): Promise<{ providerMessageId: string }> {
    const catalog = this.catalogFor(locale);
    const fmt = makeFormatters({
      locale,
      // Currency is irrelevant for a reminder but required by the formatter context; tenant default.
      currency: 'SEK',
      ...(ctx.timeZone !== undefined ? { timeZone: ctx.timeZone } : {}),
    });
    const time = fmt.date(new Date(reminder.startsAt));
    const heading = t(catalog, 'email.reminder.heading');
    const body = t(catalog, 'email.reminder.body', {
      name: ctx.name,
      program: reminder.programName,
      time,
      location: reminder.locationName,
    });
    const rendered = this.compose(
      catalog,
      'email.reminder.subject',
      { program: reminder.programName, time },
      heading,
      [body],
      ctx.dojoName,
    );
    return this.dispatch(to, rendered, { kind: 'reminder' });
  }
}
