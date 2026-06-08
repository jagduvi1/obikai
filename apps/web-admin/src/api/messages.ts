import { api } from '@obikai/api-client';
import type { BroadcastCreateInput, BroadcastResult, MessageLog } from '@obikai/domain';

/**
 * Messaging API binding (§4.8). POST a broadcast to a member segment; the server resolves recipients,
 * applies the marketing-consent gate, sends, and returns a delivery summary.
 */
export function sendBroadcast(input: BroadcastCreateInput): Promise<BroadcastResult> {
  return api.post<BroadcastResult>('/messages', input);
}

/** The per-recipient delivery report for a broadcast. */
export function deliveryReport(broadcastId: string): Promise<MessageLog[]> {
  return api.get<MessageLog[]>(`/messages/${encodeURIComponent(broadcastId)}`);
}
