import type { Adapter } from './base.js';

/**
 * SmsPort — OPTIONAL and disable-able by design (ADR-0003). The default `DisabledSmsProvider`
 * has an empty capability set and rejects sends; the notification layer branches on capability
 * (falling back to email/in-app), never on null.
 */
export type SmsCapability = 'send' | 'unicode' | 'sender-id';

export interface SmsMessage {
  readonly to: string;
  readonly body: string;
}

export interface SmsPort extends Adapter<SmsCapability> {
  readonly kind: 'sms';
  send(msg: SmsMessage): Promise<{ providerMessageId: string }>;
}
