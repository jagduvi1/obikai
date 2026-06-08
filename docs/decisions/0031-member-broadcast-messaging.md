# 0031 — Member broadcast messaging (§4.8)

**Status:** Accepted · 2026-06-08

## Context

§4.8 needs "email to members/segments". The pieces existed after Phase A/B: segment resolution
(`MemberSegment` + `MemberRepository.list/listByTags`), an `EmailPort` adapter, and append-only
consent records. Three design points had to be decided.

## Decisions

### 1. The consent split is a broadcast `category`, not a per-send guess

A broadcast carries `category: 'transactional' | 'marketing'`:

- **transactional** — operational dojo info ("tonight's class is cancelled"). Sent under contract /
  legitimate interest, so **no marketing-consent check**.
- **marketing** — promotional. Gated **per recipient** on an active `marketing_email` consent grant
  (`ConsentRepository.currentStatus(subjectId, MARKETING_EMAIL_PURPOSE) === 'granted'`).

This keeps the feature immediately useful (operational announcements work today) while staying
GDPR-correct (marketing requires opt-in). Consent is keyed by `userId`, so a member **without a login
has no consent record** → marketing is skipped for them (recorded `skipped_no_consent`, never sent
silently). A new `currentStatus(subject, purpose)` query was added to the consent port (served by the
existing `{tenantId, subjectId, purpose, createdAt:-1}` index).

### 2. Synchronous send, concurrency-bounded, hard recipient cap — for now

The **API cannot currently enqueue worker jobs** (the queue client is worker-side only). Rather than
build that infra now, `BroadcastService.broadcast` sends **synchronously** with bounded concurrency
(8 in flight) and a hard **`MAX_RECIPIENTS = 250`** cap → a `422` if the segment is larger. The cap is
**surfaced, never a silent truncation**. Async worker fan-out (enqueue a `broadcast-send` job; the
worker resolves + sends + updates the log) is the clear follow-up for large tenants.

### 3. Every recipient attempt is an immutable `MessageLog` row

One row per recipient per broadcast (`sent` / `failed` / `skipped_no_contact` / `skipped_no_consent`),
mirroring the attendance/audit immutable-log pattern (tenantGuard, record + list only). This gives a
per-member message history and a per-broadcast delivery report, and is the evidence trail for "who was
messaged and why one was skipped". The whole run is also appended to the per-tenant GDPR audit log
(`broadcast.send`, PII-minimized diff: category + segment + counts).

## Consequences

- New: `@obikai/domain` messaging types + `broadcastCreateSchema`; `MessageLogRepository`;
  `ConsentRepository.currentStatus`; `NotificationsService.sendBroadcast` (free-text subject/body,
  HTML-escaped — admin content cannot inject markup); `apps/api/src/messages` (BroadcastService +
  `POST /messages`, `GET /messages/:id`, `GET /messages?memberId`); a web-admin compose page.
- RBAC reuses the `announcement` resource (`create` to send, `read` for reports); a member may read
  their OWN message history via self-access.
- **Deferred:** async worker fan-out (lifts the recipient cap); SMS channel (the adapter is disabled
  by default); the member-app marketing-consent toggle (the consent API already exists, so marketing
  sends are testable today by granting consent); the automation builder + two-way messaging (§4.8
  differentiators).
