# 0032 — Guardianship & the member-app "subject" switcher

**Status:** Accepted · 2026-06-09

## Context

Children train at dojos; their parents are the people who actually log in to sign waivers, pay
invoices, book classes and follow belt progress. A parent is frequently **not** a club member
themselves — and a parent can have **several** children at the dojo. The data model already named a
`guardian` role and an `ownerMemberId`-scoped self-access path in `can()` (ADR-0004), but there was no
parent→child edge and no way for the member app to show a child's data to the parent.

Two questions had to be settled:

1. **How does a parent get access to a child's records** without becoming that child, and without a
   blanket grant that would leak other members' data?
2. **How does the member app, whose every page assumed "the viewer is looking at themselves",** serve a
   parent who is looking at one of several children (and may have no record of their own)?

## Decision

### Guardianship edge (backend)

A **`Guardianship`** is a persisted, tenant-scoped edge `(guardianUserId → minorMemberId)` carrying a
constrained **permission set** (`grants: Permission[]`) and a `revokedAt`. One guardian may hold many
edges (many children); re-linking the same pair is idempotent (unique `{tenantId, guardianUserId,
minorMemberId}`).

- The tenancy middleware loads a request actor's **active** edges and rides them on the `AuthzActor`
  (`actor.guardianships`), so `can()` honors "acting for a linked minor" **everywhere** without
  threading the edges through every call site. `can()` branch 3 grants a permission only when
  `ownerMemberId === the linked minor` and the edge is non-revoked.
- **`DEFAULT_GUARDIAN_GRANTS`** seed what a parent may do for a child: read/update the child's profile,
  read their invoices/attendance/promotions/curriculum, sign their waivers, and book/cancel their
  classes. This mirrors "everything the child could do for themselves" — never staff powers.
- The **`guardian` base role** additionally grants tenant-wide **read** on shared, non-sensitive
  reference data (`class`, `discipline`, `announcement`) — the same shared-read set a `member` has — so a
  guardian-only parent can browse the schedule and label a child's progress. Sensitive, member-owned
  data still comes only from the per-child edge.

Three service authorization sites had to **pass `ownerMemberId`** so the guardianship branch can fire
(passing `ownerMemberId` never widens a role grant — `can()` branch 1 ignores it, so staff/owner are
unaffected): `AttendanceService.list`, `BookingsService.authorize` (book/cancel), and the already-correct
`InvoicesService.list` pattern they now match.

### Member-app "subject" model (frontend)

The member app introduces a **subject** = *whose data the pages currently show*. A `SubjectProvider`
loads `GET /me` + `GET /me/dependents` and exposes the list of subjects (the signed-in member's own
record, if any, plus each child) and the **active** one. Every data page reads `activeMemberId` from the
provider instead of assuming `me.memberId`. A header **switcher** (rendered only when there is more than
one subject) changes the active subject; the choice is persisted in `sessionStorage` so it survives the
per-route remount of the authenticated shell.

- The provider is mounted **inside** the authenticated shell, so it never fetches while anonymous and
  needs no coupling to the auth context.
- **Profile** ("my account") is deliberately **not** subject-switched — it always edits the signed-in
  user's own record; a guardian-only account sees a short note instead of an empty form.
- **Self check-in** is hidden when viewing a child (it is the logged-in member putting *themselves* on
  the mat; checking a child in is a mat-side/instructor action, not self-service).
- When a parent signs a child's waiver it is recorded as a **guardian signature**
  (`isGuardian: true`, `guardianForMemberId = the child`), preserving the legal record.

## Consequences

- A guardian-only parent now logs in and lands on a usable app: pick a child, see their progress,
  attendance, invoices and waivers, and book their classes — all authorized by the per-child edge, so
  the 200/403 boundary is exactly "this parent, this child, these grants".
- New surface: `GET /me/dependents`; `Guardianship` domain type + repo; `actor.guardianships` on the
  authz actor. No data migration (pre-prod; edges are created as parents are linked).
- **Deferred:** a parent **on-behalf check-in** endpoint (distinct from self check-in); guardian editing
  of a child's full profile from the member app (today a parent edits a child's contact details via the
  admin/staff path); an end-to-end guardian **integration** test booting the real app (the `can()` unit
  tests + manual end-to-end verification cover the authorization today).
