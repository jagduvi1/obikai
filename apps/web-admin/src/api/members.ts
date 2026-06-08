import { api } from '@obikai/api-client';
import type { Member, MemberCreateInput, MemberStatus, MemberUpdateInput } from '@obikai/domain';

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

export function createMember(input: MemberCreateInput): Promise<Member> {
  return api.post<Member>('/members', input);
}

export function updateMember(id: string, patch: MemberUpdateInput): Promise<Member> {
  return api.patch<Member>(`/members/${encodeURIComponent(id)}`, patch);
}

/** Invite a member to set up a portal login (emails the accept link). Resolves on 204. */
export function inviteMember(id: string): Promise<void> {
  return api.post<void>(`/members/${encodeURIComponent(id)}/invite`);
}
