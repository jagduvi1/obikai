import { useQuery } from '@tanstack/react-query';
import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { getDependents, getMe } from '../api/member-data';

/**
 * The member app can be used by a member for themselves AND by a parent acting for their children
 * (ADR-0004 guardianship). A "subject" is *whose data the pages currently show*: the signed-in
 * member's own record (if they are a member) plus each minor they guardian (GET /me/dependents). The
 * switcher in the header changes the active subject; every data page reads `activeMemberId` from here
 * instead of assuming the viewer is looking at themselves. A guardian-only parent (no own member
 * record) simply has their children as the only subjects.
 *
 * The provider is mounted INSIDE the authenticated shell (RequireAuth), so it never fetches while
 * anonymous and needs no auth coupling. The chosen subject is persisted in sessionStorage so it
 * survives the per-route remount of the shell (and a page reload).
 */
export interface Subject {
  /** The member whose data the pages show. */
  memberId: string;
  /** The child's display name. Empty for the account holder's own record — the UI labels that "Me". */
  name: string;
  /** True for the signed-in member's OWN record; false for a child they guardian. */
  isSelf: boolean;
}

interface SubjectState {
  loading: boolean;
  isError: boolean;
  /** Everyone the signed-in user can view: themselves (if a member) + each child they guardian. */
  subjects: readonly Subject[];
  /** The member id currently being viewed; null only while loading or for an account with no subjects. */
  activeMemberId: string | null;
  active: Subject | null;
  setActiveMemberId: (memberId: string) => void;
  /** The signed-in user's OWN member id, or null for a guardian-only (non-member) account. */
  selfMemberId: string | null;
}

const SubjectContext = createContext<SubjectState | null>(null);

const STORAGE_KEY = 'obikai.activeSubject';

function readStoredSubject(): string | null {
  try {
    return sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function storeSubject(memberId: string): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, memberId);
  } catch {
    // Private-mode / disabled storage: selection simply won't persist across remounts. Non-fatal.
  }
}

export function SubjectProvider({ children }: { children: ReactNode }) {
  const me = useQuery({ queryKey: ['me'], queryFn: getMe });
  const dependents = useQuery({ queryKey: ['dependents'], queryFn: getDependents });

  const selfMemberId = me.data?.memberId ?? null;

  const subjects = useMemo<Subject[]>(() => {
    const list: Subject[] = [];
    if (selfMemberId) list.push({ memberId: selfMemberId, name: '', isSelf: true });
    for (const d of dependents.data ?? []) {
      list.push({ memberId: d.id, name: `${d.firstName} ${d.lastName}`.trim(), isSelf: false });
    }
    return list;
  }, [selfMemberId, dependents.data]);

  const [activeMemberId, setActiveMemberIdState] = useState<string | null>(() =>
    readStoredSubject(),
  );

  const setActiveMemberId = useCallback((memberId: string) => {
    storeSubject(memberId);
    setActiveMemberIdState(memberId);
  }, []);

  // Default to the first subject (own record if a member, else the first child) and keep the choice
  // stable; only reset if the active id is null or no longer among the subjects (e.g. once data loads,
  // or a previously-stored child was unlinked).
  useEffect(() => {
    const first = subjects[0];
    if (!first) return;
    if (activeMemberId && subjects.some((s) => s.memberId === activeMemberId)) return;
    setActiveMemberId(first.memberId);
  }, [subjects, activeMemberId, setActiveMemberId]);

  const value = useMemo<SubjectState>(() => {
    const active = subjects.find((s) => s.memberId === activeMemberId) ?? null;
    return {
      loading: me.isLoading || dependents.isLoading,
      isError: me.isError || dependents.isError,
      subjects,
      activeMemberId,
      active,
      setActiveMemberId,
      selfMemberId,
    };
  }, [
    me.isLoading,
    me.isError,
    dependents.isLoading,
    dependents.isError,
    subjects,
    activeMemberId,
    setActiveMemberId,
    selfMemberId,
  ]);

  return <SubjectContext.Provider value={value}>{children}</SubjectContext.Provider>;
}

export function useSubject(): SubjectState {
  const ctx = useContext(SubjectContext);
  if (!ctx) throw new Error('useSubject must be used within a SubjectProvider');
  return ctx;
}
