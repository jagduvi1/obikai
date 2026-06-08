import type { Locale } from '@obikai/domain';
import type { Catalog } from '@obikai/i18n';

/**
 * Runtime email-namespace catalogs for the notifications layer (ADR-0003: WE render copy; the
 * provider only transports). These mirror the source-of-truth UI catalogs in
 * `packages/i18n/catalogs/<locale>/email.json`. They are colocated here only because the i18n
 * package does not (yet) expose its JSON catalogs through a package `exports` subpath — see the
 * integration note proposing an `@obikai/i18n/catalogs/*` export so apps load the single source.
 *
 * Keep these in lockstep with the JSON catalogs. Every key/value here must equal the corresponding
 * `email.json` entry for the same locale.
 */
const en: Catalog = {
  'email.receipt.subject': 'Your receipt from {dojo} — invoice {number}',
  'email.receipt.heading': 'Thank you for your payment',
  'email.receipt.body':
    'Hi {name}, we have received your payment of {total} for invoice {number}. This email is your receipt.',
  'email.receipt.lines.header': 'Invoice items',
  'email.receipt.line': '{description} × {quantity} — {lineTotal}',
  'email.receipt.totals': 'Subtotal {subtotal} · VAT {vatTotal} · Total {total}',
  'email.dunning.subject': 'Payment overdue — invoice {number} from {dojo}',
  'email.dunning.heading': 'Your invoice is overdue',
  'email.dunning.body':
    'Hi {name}, invoice {number} for {total} is now overdue (reminder {stage}). Please settle it to keep your membership active.',
  'email.dunning.action': 'Pay now to avoid interruption to your training.',
  'email.waiver.subject': 'Please sign your waiver — {dojo}',
  'email.waiver.heading': 'A waiver needs your signature',
  'email.waiver.body':
    'Hi {name}, please review and sign the waiver "{title}" for {memberName} before your next class.',
  'email.waiver.action': 'Sign the waiver to complete your registration.',
  'email.reminder.subject': 'Reminder: {program} at {time}',
  'email.reminder.heading': 'Your class is coming up',
  'email.reminder.body':
    'Hi {name}, this is a reminder that {program} starts at {time} at {location}. See you on the mat!',
  'email.signature': '— The team at {dojo}',
};

const sv: Catalog = {
  'email.receipt.subject': 'Ditt kvitto från {dojo} — faktura {number}',
  'email.receipt.heading': 'Tack för din betalning',
  'email.receipt.body':
    'Hej {name}, vi har tagit emot din betalning på {total} för faktura {number}. Detta e-postmeddelande är ditt kvitto.',
  'email.receipt.lines.header': 'Fakturarader',
  'email.receipt.line': '{description} × {quantity} — {lineTotal}',
  'email.receipt.totals': 'Delsumma {subtotal} · Moms {vatTotal} · Totalt {total}',
  'email.dunning.subject': 'Förfallen betalning — faktura {number} från {dojo}',
  'email.dunning.heading': 'Din faktura har förfallit',
  'email.dunning.body':
    'Hej {name}, faktura {number} på {total} har nu förfallit (påminnelse {stage}). Betala den för att behålla ditt medlemskap aktivt.',
  'email.dunning.action': 'Betala nu för att undvika avbrott i din träning.',
  'email.waiver.subject': 'Signera din ansvarsfriskrivning — {dojo}',
  'email.waiver.heading': 'En ansvarsfriskrivning behöver din signatur',
  'email.waiver.body':
    'Hej {name}, granska och signera ansvarsfriskrivningen "{title}" för {memberName} före din nästa klass.',
  'email.waiver.action': 'Signera ansvarsfriskrivningen för att slutföra din registrering.',
  'email.reminder.subject': 'Påminnelse: {program} kl. {time}',
  'email.reminder.heading': 'Din klass börjar snart',
  'email.reminder.body':
    'Hej {name}, detta är en påminnelse om att {program} börjar kl. {time} på {location}. Vi ses på mattan!',
  'email.signature': '— Teamet på {dojo}',
};

/** Per-locale email catalogs. Locales without a catalog fall back to the platform default ('en'). */
export const EMAIL_CATALOGS: Partial<Record<Locale, Catalog>> = { en, sv };
