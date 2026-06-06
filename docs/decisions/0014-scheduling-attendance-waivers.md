# 0014 — Classes/scheduling, attendance & waivers

**Status:** Accepted · 2026-06-06

## Context

Phase 1 dojo core (scope §4.3/§4.4/§4.10): a recurring class schedule with booking + waitlists,
kiosk/instructor attendance, and digital waivers (incl. minor waivers). Attendance is also the
bridge to the rank engine (classes-since-last-promotion, ADR-0005).

## Decision

- **Scheduling:** `Program` (a class definition, optionally linked to a rank `disciplineId`) →
  `ClassSchedule` (a recurring **iCal RRULE** + start time + duration + capacity, per location/tz)
  → `ClassOccurrence` (a concrete dated instance). **Occurrences are materialized** from the RRULE
  by a worker job over a rolling horizon; **one-off cancellations/overrides live on the occurrence,
  not the rule** (§7), so editing a series never loses exceptions. `Booking` reserves a member onto
  one occurrence with a `booked|waitlisted|…` lifecycle; capacity is enforced at booking time and
  waitlist promotion happens on cancellation.
- **Attendance:** an immutable `Attendance` row per check-in (`kiosk_pin|kiosk_qr|instructor|self|
  import`), carrying `memberId`, optional `occurrenceId`/`programId`, **`disciplineId`** and
  `occurredAt`. Indexed `{tenantId, memberId, disciplineId, occurredAt}` so "classes since last
  promotion in discipline X" is a cheap range count the app feeds to the **pure** rank engine — the
  engine never queries (ADR-0005).
- **Waivers:** `WaiverTemplate` is **versioned** (editing the body mints a new version);
  `WaiverSignature` **pins the template version**, is immutable + timestamped, records signer + IP,
  and (for minors) the guardian who signed on the member's behalf. The rendered signed document is
  stored in object storage (S3/MinIO) via the storage adapter; the signature row holds the key.

## Consequences

- RRULE materialization keeps the schedule compact while supporting per-occurrence overrides;
  timezone is explicit per schedule (DST-correct occurrence times).
- Attendance immutability + the discipline index make the rank "ready/close" dashboard cheap and
  keep the engine deterministic.
- Versioned waivers + version-pinned signatures satisfy the "what did they actually agree to"
  evidentiary requirement; signatures are GDPR-exportable and survive erasure as anonymized records
  where a legal basis to retain exists (ADR-0007).

## Alternatives considered

Storing every future class as a row (no RRULE) — explodes storage, loses the rule/override
distinction; editing a series in place — destroys exceptions; mutable waivers — can't prove past
consent. All rejected.
