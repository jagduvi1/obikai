import { api } from '@obikai/api-client';
import type { Member, MemberCreateInput, MemberStatus, MemberUpdateInput } from '@obikai/domain';

/**
 * Members API binding. Reusing the shared `@obikai/domain` types is the payoff of the TS-end-to-end
 * monorepo: the admin renders exactly the shapes the api returns, type-checked across the wire.
 */
export function listMembers(opts: { status?: MemberStatus; tag?: string } = {}): Promise<Member[]> {
  const params = new URLSearchParams();
  if (opts.status) params.set('status', opts.status);
  if (opts.tag) params.set('tag', opts.tag);
  const qs = params.toString();
  return api.get<Member[]>(`/members${qs ? `?${qs}` : ''}`);
}

/** Free-text member lookup (name/email/phone) — for roster add + recipient pickers. */
export function searchMembers(q: string, limit?: number): Promise<Member[]> {
  if (q.trim() === '') return Promise.resolve([]);
  const params = new URLSearchParams({ q });
  if (limit) params.set('limit', String(limit));
  return api.get<Member[]>(`/members/search?${params.toString()}`);
}

/** Replace a member's tag set (segment labels). */
export function setMemberTags(id: string, tags: string[]): Promise<Member> {
  return api.put<Member>(`/members/${encodeURIComponent(id)}/tags`, { tags });
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
