import type { Member, MemberStatus } from '@obikai/domain';
import { api } from './client';

/**
 * Members API binding. Reusing the shared `@obikai/domain` types is the payoff of the TS-end-to-end
 * monorepo: the admin renders exactly the shapes the api returns, type-checked across the wire.
 */
export function listMembers(opts: { status?: MemberStatus } = {}): Promise<Member[]> {
  const qs = opts.status ? `?status=${encodeURIComponent(opts.status)}` : '';
  return api.get<Member[]>(`/members${qs}`);
}

export function getMember(id: string): Promise<Member> {
  return api.get<Member>(`/members/${encodeURIComponent(id)}`);
}
