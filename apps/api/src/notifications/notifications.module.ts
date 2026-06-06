import { Module } from '@nestjs/common';
import { type SmtpConfig, SmtpEmailProvider } from '@obikai/adapter-email-smtp';
import type { AppConfig } from '@obikai/config';
import { APP_CONFIG } from '../config.provider.js';
import { EMAIL_CATALOGS } from './email-catalogs.js';
import { NotificationsService } from './notifications.service.js';

/** Injection token for the SMTP email port (ADR-0003: the default EmailPort implementation). */
const EMAIL_PORT = 'EMAIL_PORT';

/**
 * Notifications wiring (scope §4.8, §5). Builds the default SMTP EmailPort from APP_CONFIG.email
 * (ADR-0009: env is read only by @obikai/config and threaded in as APP_CONFIG) and constructs the
 * framework-free NotificationsService with the `email`-namespace catalogs. WE render copy; the
 * provider only transports (ADR-0003).
 *
 * The provider is built via its direct constructor rather than `SmtpEmailProviderFactory`: the
 * factory resolves `user`/`pass` from SecretRefs via an AdapterContext, but self-host SMTP
 * credentials arrive already-resolved on AppConfig (ADR-0009), so we pass them straight into
 * `SmtpConfig`. `init()` is awaited in the async factory so the transporter is open before first
 * send.
 */
@Module({
  providers: [
    {
      provide: EMAIL_PORT,
      useFactory: async (config: AppConfig): Promise<SmtpEmailProvider> => {
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
        return provider;
      },
      inject: [APP_CONFIG],
    },
    {
      provide: NotificationsService,
      useFactory: (email: SmtpEmailProvider) => new NotificationsService(email, EMAIL_CATALOGS),
      inject: [EMAIL_PORT],
    },
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
