/**
 * Worker-side transactional email wiring (scope §4.8, §5; ADR-0003).
 *
 * The worker drains background jobs (dunning, reminders) that need to SEND mail, but it cannot import
 * the api's NotificationsModule (apps cannot depend on apps — ADR-0003). So it builds the same
 * framework-free `NotificationsService` from `@obikai/notifications` directly, over the default SMTP
 * `EmailPort`. WE render subject/text/html from the `email` i18n catalogs; the provider only
 * transports (ADR-0003).
 *
 * Construction is best-effort and OPTIONAL: only the built-in `smtp` provider has an adapter, so for
 * any other configured provider (or a self-host with mail not yet set up) we return `null` and the
 * jobs run as before, minus the notice. A failure to email an overdue notice must NEVER abort the
 * dunning sweep that already advanced the ladder — callers wrap each `dunningNotice` in try/catch.
 */
import { type SmtpConfig, SmtpEmailProvider } from '@obikai/adapter-email-smtp';
import type { AppConfig } from '@obikai/config';
import {
  ClassScheduleRepository,
  LocationRepository,
  MemberRepository,
  ProgramRepository,
  TenantRegistryRepository,
} from '@obikai/db';
import {
  type Booking,
  type ClassOccurrence,
  DEFAULT_LOCALE,
  type Invoice,
  type Locale,
} from '@obikai/domain';
import { EMAIL_CATALOGS, NotificationsService } from '@obikai/notifications';

type Log = (msg: string, meta?: Record<string, unknown>) => void;

/** The notice-sending surface the jobs need, plus a `dispose()` to close the SMTP transport on shutdown. */
export interface WorkerNotifier {
  /**
   * Email the member the dunning notice for an invoice that was just advanced along the ladder. Runs
   * inside the invoice's already-open tenant context, so the member/tenant lookups are tenant-scoped.
   * Resolves quietly (logs) when the member has no email on file — there is simply no one to notify.
   */
  dunningNotice(tenantId: string, invoice: Invoice): Promise<void>;
  /**
   * Email the booked member their upcoming-class reminder. Runs inside the occurrence's already-open
   * tenant context, so the program/location/schedule/member lookups are tenant-scoped. Returns false
   * when the member has no email on file (nothing was sent); true when a reminder was dispatched.
   */
  classReminder(tenantId: string, occurrence: ClassOccurrence, booking: Booking): Promise<boolean>;
  /** Close the underlying SMTP transport. */
  dispose(): Promise<void>;
}

/**
 * Build the worker notifier from config, or `null` when email is not available (non-smtp provider).
 * The SMTP credentials arrive already-resolved on `AppConfig` (ADR-0009), so we pass them straight
 * into `SmtpConfig` and `init()` the transport before returning — mirroring the api's NotificationsModule.
 */
export async function buildWorkerNotifier(
  config: AppConfig,
  log: Log,
): Promise<WorkerNotifier | null> {
  if (config.email.provider !== 'smtp') {
    // Only the built-in smtp adapter ships today; ses/postmark have no worker-side impl yet. Run the
    // jobs without notices rather than crash the worker on an unconfigured provider.
    log('notifications disabled: email provider has no worker adapter', {
      provider: config.email.provider,
    });
    return null;
  }

  const smtp = config.email.smtp;
  const smtpConfig: SmtpConfig = {
    host: smtp.host ?? 'localhost',
    port: smtp.port ?? 587,
    secure: smtp.secure,
    user: smtp.user,
    pass: smtp.pass,
    from: config.email.from,
  };
  const provider = new SmtpEmailProvider(smtpConfig);
  await provider.init();

  const notifications = new NotificationsService(provider, EMAIL_CATALOGS);
  const members = new MemberRepository();
  const tenants = new TenantRegistryRepository();
  const programs = new ProgramRepository();
  const locations = new LocationRepository();
  const schedules = new ClassScheduleRepository();

  return {
    async dunningNotice(tenantId: string, invoice: Invoice): Promise<void> {
      const member = await members.findById(invoice.memberId);
      if (!member?.email) {
        log('dunning: member has no email; notice skipped', {
          invoiceId: invoice.id,
          memberId: invoice.memberId,
        });
        return;
      }
      const tenant = await tenants.findBySlug(tenantId);
      const dojoName = tenant?.name ?? tenantId;
      const name = `${member.firstName} ${member.lastName}`.trim() || member.email;
      // No per-tenant default locale on the Tenant yet (TODO: thread tenant locale once modelled) —
      // fall back to the platform default; the catalog itself falls back to 'en' for any gap.
      const locale: Locale = DEFAULT_LOCALE;
      await notifications.sendDunningNotice(
        { email: member.email, name },
        locale,
        {
          invoiceNumber: invoice.number ?? '—',
          currency: invoice.currency,
          totalMinor: invoice.total.amountMinor,
          dunningStage: invoice.dunningStage,
        },
        { name, dojoName, tenantDefaultLocale: locale },
      );
    },

    async classReminder(
      tenantId: string,
      occurrence: ClassOccurrence,
      booking: Booking,
    ): Promise<boolean> {
      const member = await members.findById(booking.memberId);
      if (!member?.email) {
        log('reminders: member has no email; skipped', {
          occurrenceId: occurrence.id,
          memberId: booking.memberId,
        });
        return false;
      }
      // Resolve the occurrence's display context once. The schedule supplies the dojo-local timezone
      // so the class time renders in the member's expected wall-clock, not UTC.
      const [program, location, schedule, tenant] = await Promise.all([
        programs.findById(occurrence.programId),
        locations.findById(occurrence.locationId),
        schedules.findById(occurrence.scheduleId),
        tenants.findBySlug(tenantId),
      ]);
      const name = `${member.firstName} ${member.lastName}`.trim() || member.email;
      const locale: Locale = DEFAULT_LOCALE; // TODO: per-tenant default locale once modelled.
      await notifications.sendClassReminder(
        { email: member.email, name },
        locale,
        {
          programName: program?.name ?? 'class',
          locationName: location?.name ?? '',
          startsAt: occurrence.startsAt,
        },
        {
          name,
          dojoName: tenant?.name ?? tenantId,
          tenantDefaultLocale: locale,
          ...(schedule?.timezone ? { timeZone: schedule.timezone } : {}),
        },
      );
      return true;
    },

    async dispose(): Promise<void> {
      await provider.dispose();
    },
  };
}
