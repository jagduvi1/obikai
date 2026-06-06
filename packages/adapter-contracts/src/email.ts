import type { Adapter } from './base.js';

/**
 * EmailPort — default implementation is SMTP (the universal self-hostable baseline, ADR-0003).
 * Subject/html/text are rendered by OUR i18n layer before they reach the port, so no provider's
 * templating feature is depended on (this is the fix for Glosan's hardcoded Resend).
 */
export type EmailCapability = 'send' | 'batch' | 'inbound';

export interface EmailRecipient {
  readonly email: string;
  readonly name?: string;
}

export interface EmailMessage {
  readonly to: readonly EmailRecipient[];
  readonly subject: string;
  readonly html: string;
  readonly text: string;
  readonly replyTo?: string;
  readonly tags?: Readonly<Record<string, string>>;
}

export interface EmailPort extends Adapter<EmailCapability> {
  readonly kind: 'email';
  send(msg: EmailMessage): Promise<{ providerMessageId: string }>;
}
