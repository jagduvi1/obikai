import type { BroadcastCategory, MessageChannel, MessageLog, MessageStatus } from '@obikai/domain';
import mongoose, { type Model, Schema, type Types } from 'mongoose';
import type { TenantScoped } from './repository.js';
import { tenantGuard } from './tenant-guard.js';

/**
 * MessageLog persistence (scope §4.8). One IMMUTABLE row per broadcast recipient attempt — the audit
 * of who was messaged (and why one was skipped). Like attendance, rows are only recorded + listed,
 * never updated. Tenant-scoped via `tenantGuard`.
 */
export interface MessageLogDoc extends TenantScoped {
  _id: Types.ObjectId;
  broadcastId: string;
  memberId: string;
  channel: MessageChannel;
  category: BroadcastCategory;
  subject: string;
  status: MessageStatus;
  providerMessageId: string | null;
  error: string | null;
  createdAt: Date;
}

const schema = new Schema<MessageLogDoc>(
  {
    broadcastId: { type: String, required: true },
    memberId: { type: String, required: true },
    channel: { type: String, required: true },
    category: { type: String, required: true },
    subject: { type: String, required: true },
    status: { type: String, required: true },
    providerMessageId: { type: String, default: null },
    error: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

schema.plugin(tenantGuard);
// Per-broadcast delivery report.
schema.index({ tenantId: 1, broadcastId: 1, createdAt: 1 });
// Per-member message history.
schema.index({ tenantId: 1, memberId: 1, createdAt: -1 });

export const MessageLogModel: Model<MessageLogDoc> =
  (mongoose.models.MessageLog as Model<MessageLogDoc> | undefined) ??
  mongoose.model<MessageLogDoc>('MessageLog', schema);

export function toMessageLog(doc: MessageLogDoc): MessageLog {
  return {
    id: doc._id.toString() as MessageLog['id'],
    tenantId: doc.tenantId as MessageLog['tenantId'],
    broadcastId: doc.broadcastId,
    memberId: doc.memberId as MessageLog['memberId'],
    channel: doc.channel,
    category: doc.category,
    subject: doc.subject,
    status: doc.status,
    providerMessageId: doc.providerMessageId ?? null,
    error: doc.error ?? null,
    createdAt: doc.createdAt.toISOString(),
  };
}

export interface MessageLogCreateInput {
  broadcastId: string;
  memberId: string;
  channel: MessageChannel;
  category: BroadcastCategory;
  subject: string;
  status: MessageStatus;
  providerMessageId?: string | null;
  error?: string | null;
}

/** Tenant-scoped MessageLog repository (immutable: record + list only). */
export class MessageLogRepository {
  constructor(private readonly model: Model<MessageLogDoc> = MessageLogModel) {}

  async record(input: MessageLogCreateInput): Promise<MessageLog> {
    const created = await this.model.create({
      broadcastId: input.broadcastId,
      memberId: input.memberId,
      channel: input.channel,
      category: input.category,
      subject: input.subject,
      status: input.status,
      providerMessageId: input.providerMessageId ?? null,
      error: input.error ?? null,
    });
    return toMessageLog(created.toObject() as unknown as MessageLogDoc);
  }

  /** All recipient rows of one broadcast (the delivery report), oldest first. */
  async listByBroadcast(broadcastId: string): Promise<MessageLog[]> {
    const docs = await this.model
      .find({ broadcastId: String(broadcastId) })
      .sort({ createdAt: 1 })
      .lean<MessageLogDoc[]>()
      .exec();
    return docs.map(toMessageLog);
  }

  /** A member's message history, newest first. */
  async listByMember(memberId: string): Promise<MessageLog[]> {
    const docs = await this.model
      .find({ memberId: String(memberId) })
      .sort({ createdAt: -1 })
      .lean<MessageLogDoc[]>()
      .exec();
    return docs.map(toMessageLog);
  }
}
