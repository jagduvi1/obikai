import { z } from 'zod';
import type { MemberId, TenantId } from './ids.js';
import { memberSegmentSchema } from './member.js';

/**
 * Communications & messaging (scope §4.8). A broadcast sends an admin-authored message to a member
 * segment. Its `category` drives the lawful basis:
 *  - `transactional` — operational dojo info (e.g. "tonight's class is cancelled"); sent under
 *    contract / legitimate interest, so NO marketing-consent check.
 *  - `marketing` — promotional; gated on an active `marketing_email` consent grant per recipient.
 *
 * Every recipient attempt is recorded as an immutable `MessageLog` row (per-member history + a
 * per-broadcast delivery summary), so a dojo can show who was messaged and why one was skipped.
 */

export const BROADCAST_CATEGORIES = ['transactional', 'marketing'] as const;
export type BroadcastCategory = (typeof BROADCAST_CATEGORIES)[number];

export const MESSAGE_CHANNELS = ['email'] as const; // SMS later (the adapter is disabled by default)
export type MessageChannel = (typeof MESSAGE_CHANNELS)[number];

/** Per-recipient outcome: delivered, failed at the provider, or skipped (no contact / no consent). */
export const MESSAGE_STATUSES = [
  'sent',
  'failed',
  'skipped_no_contact',
  'skipped_no_consent',
] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

export interface MessageLog {
  readonly id: string;
  readonly tenantId: TenantId;
  /** Groups all per-recipient rows of one broadcast. */
  readonly broadcastId: string;
  readonly memberId: MemberId;
  readonly channel: MessageChannel;
  readonly category: BroadcastCategory;
  readonly subject: string;
  readonly status: MessageStatus;
  readonly providerMessageId: string | null;
  readonly error: string | null;
  readonly createdAt: string;
}

/** Admin request to broadcast a message to a member segment. */
export const broadcastCreateSchema = z.object({
  segment: memberSegmentSchema,
  category: z.enum(BROADCAST_CATEGORIES),
  channel: z.enum(MESSAGE_CHANNELS).default('email'),
  subject: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(10_000),
});
export type BroadcastCreateInput = z.infer<typeof broadcastCreateSchema>;

/** Summary returned after a broadcast runs (the breakdown the admin sees). */
export interface BroadcastResult {
  readonly broadcastId: string;
  readonly total: number;
  readonly sent: number;
  readonly failed: number;
  readonly skippedNoContact: number;
  readonly skippedNoConsent: number;
}
