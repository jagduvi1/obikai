import { realpathSync } from 'node:fs';
import { argv } from 'node:process';
import { fileURLToPath } from 'node:url';
import { Logger } from '@nestjs/common';
import { hashPassword } from '@obikai/adapter-auth-local';
import { DEFAULT_GUARDIAN_GRANTS } from '@obikai/authz';
import { type AppConfig, loadConfig } from '@obikai/config';
import {
  AttendanceRepository,
  BookingRepository,
  ClassOccurrenceRepository,
  ClassScheduleRepository,
  ConsentRepository,
  DisciplineRepository,
  EnrollmentRepository,
  GuardianshipRepository,
  HouseholdRepository,
  IdentityRepository,
  InvoiceCounterRepository,
  InvoiceRepository,
  LocationRepository,
  MemberRankStateRepository,
  MemberRepository,
  MembershipRepository,
  PlanRepository,
  ProgramRepository,
  PromotionRepository,
  RankSystemRepository,
  type TenantContext,
  UserRepository,
  VatRateRepository,
  WaiverSignatureRepository,
  WaiverTemplateRepository,
  connectMongo,
  disconnectMongo,
  expandWeekly,
  runInTenantContext,
} from '@obikai/db';
import { type Member, buildInvoiceLine, invoiceTotals } from '@obikai/domain';
import { MARKETING_EMAIL_PURPOSE } from '@obikai/gdpr';
import { mintVersion, validateConfig } from '@obikai/rank-engine';

/**
 * `obikai seed-demo` — populate a single-tenant self-host dojo with a realistic EXAMPLE dataset for
 * hands-on testing (NOT production). Coarse-idempotent: if the dojo already has the demo members it
 * skips. Run inside the api container: `node dist/cli/seed-demo.js`. Everything runs in one tenant
 * context (ADR-0004) exactly like create-owner.ts.
 *
 * Demonstrates the parent/guardian model (§4.10): a guardian-only parent (NOT a club member) with TWO
 * kids, and a parent who is ALSO a member (one account, two hats).
 */

const NOW = '2026-06-09';
const member = (m: Member) => m; // identity helper for readability

async function loginFor(email: string, password: string): Promise<string> {
  const identities = new IdentityRepository();
  const existing = await identities.findByEmailLower('local', email.toLowerCase());
  if (existing) return existing.userId;
  const user = await new UserRepository().create({ email, emailVerified: true });
  await identities.create({
    userId: user.id,
    provider: 'local',
    email,
    passwordHash: hashPassword(password),
    emailVerified: true,
  });
  return user.id;
}

export async function seedDemo(
  config: AppConfig,
  logger: Logger = new Logger('seed-demo'),
): Promise<void> {
  if (config.tenancy !== 'single' || config.selfHostTenantSlug === null) {
    throw new Error('seed-demo is only for single-tenant self-host');
  }
  const tenantId = config.selfHostTenantSlug;
  const ownerEmail = config.bootstrapOwner?.email ?? 'owner@example.com';

  await connectMongo(config.mongoUri);
  try {
    // The seed acts as the owner (resolve the bootstrap owner's user, like create-owner did).
    const ownerIdentity = await new IdentityRepository().findByEmailLower(
      'local',
      ownerEmail.toLowerCase(),
    );
    if (!ownerIdentity)
      throw new Error(`run create-owner first — no owner identity for ${ownerEmail}`);
    const ownerUserId = ownerIdentity.userId;

    const ctx: TenantContext = {
      tenantId,
      userId: ownerUserId,
      sessionId: null,
      roles: [{ role: 'owner', locationScope: 'ALL' }],
      memberId: null,
      requestId: 'seed-demo',
      tenancy: 'single',
    };

    await runInTenantContext(ctx, async () => {
      const members = new MemberRepository();
      if ((await members.list()).length > 5) {
        logger.warn('dojo already has demo members — skipping seed (drop the DB to re-seed).');
        return;
      }

      // ── Locations + VAT ──────────────────────────────────────────────────
      const locations = new LocationRepository();
      const locA = await locations.create({
        name: 'Mydojo Central',
        timezone: 'Europe/Stockholm',
        address: 'Sveavägen 10, Stockholm',
      });
      const vat = await new VatRateRepository().create({ name: 'Standard 25%', percent: 25 });
      logger.log('Seeded location + VAT rate.');

      // ── Disciplines + rank ladders (the crown jewel) ─────────────────────
      const disciplines = new DisciplineRepository();
      const bjj = await disciplines.create({
        name: { en: 'Brazilian Jiu-Jitsu', sv: 'Brasiliansk jiu-jitsu' },
        presentation: 'belt',
        active: true,
      });
      const karate = await disciplines.create({
        name: { en: 'Kids Karate', sv: 'Karate för barn' },
        presentation: 'belt',
        active: true,
      });

      const ranks = new RankSystemRepository();
      const publish = async (cfg: Record<string, unknown>) => {
        const r = validateConfig(cfg as never);
        if (!r.valid) throw new Error(`invalid rank config: ${JSON.stringify(r.errors)}`);
        const prior = await ranks.getCurrentVersion((cfg as { systemId: string }).systemId);
        const version = mintVersion(prior, r.draft);
        try {
          await ranks.publishVersion(version);
        } catch {
          /* DuplicateVersionError on re-run — the immutable version already exists. */
        }
        return version;
      };
      const allOf = (criteria: unknown[] = []) => ({ type: 'allOf', criteria });
      const minClasses = (count: number) => ({
        type: 'minClassesSinceLastPromotion',
        count,
        enforcement: 'required',
      });
      const bjjVersion = await publish({
        disciplineId: bjj.id,
        systemId: 'bjj-adult',
        presentation: 'belt',
        tracks: [{ id: 'adult' }],
        ladder: [
          {
            id: 'white',
            kind: 'rank',
            order: 0,
            trackId: 'adult',
            visual: { primaryColor: '#FFFFFF', pattern: 'solid' },
            criteria: allOf(),
          },
          {
            id: 'blue',
            kind: 'rank',
            order: 1,
            trackId: 'adult',
            visual: { primaryColor: '#1565C0', pattern: 'solid' },
            criteria: allOf([minClasses(60)]),
          },
          {
            id: 'purple',
            kind: 'rank',
            order: 2,
            trackId: 'adult',
            visual: { primaryColor: '#6A1B9A', pattern: 'solid' },
            criteria: allOf([minClasses(120)]),
          },
        ],
        transitions: [],
        curricula: [],
      });
      const karateVersion = await publish({
        disciplineId: karate.id,
        systemId: 'kids-karate',
        presentation: 'belt',
        tracks: [{ id: 'kids', minAgeYears: 4, maxAgeYears: 12 }],
        ladder: [
          {
            id: 'k-white',
            kind: 'rank',
            order: 0,
            trackId: 'kids',
            visual: { primaryColor: '#FFFFFF', pattern: 'solid' },
            criteria: allOf(),
          },
          {
            id: 'k-yellow',
            kind: 'rank',
            order: 1,
            trackId: 'kids',
            visual: { primaryColor: '#FDD835', pattern: 'solid' },
            criteria: allOf([minClasses(20)]),
          },
          {
            id: 'k-orange',
            kind: 'rank',
            order: 2,
            trackId: 'kids',
            visual: { primaryColor: '#FB8C00', pattern: 'solid' },
            criteria: allOf([minClasses(30)]),
          },
        ],
        transitions: [],
        curricula: [],
      });
      logger.log('Seeded disciplines + rank ladders (BJJ, Kids Karate).');

      // ── Households ───────────────────────────────────────────────────────
      const households = new HouseholdRepository();
      const hhSvensson = await households.create({ name: 'Svensson family' });

      // ── Members ──────────────────────────────────────────────────────────
      const mk = (input: Parameters<MemberRepository['create']>[0]) => members.create(input);
      // Adults (BJJ).
      const anna = await mk({
        firstName: 'Anna',
        lastName: 'Svensson',
        email: 'anna@example.com',
        dateOfBirth: '1990-04-12',
        householdId: hhSvensson.id,
        status: 'active',
        joinDate: '2024-09-01',
        tags: ['competitor'],
      });
      const erik = await mk({
        firstName: 'Erik',
        lastName: 'Larsen',
        email: 'erik@example.com',
        dateOfBirth: '1988-07-03',
        status: 'active',
        joinDate: '2024-10-15',
      });
      const mei = await mk({
        firstName: 'Mei',
        lastName: 'Tan',
        dateOfBirth: '1995-02-20',
        status: 'active',
        joinDate: '2025-01-10',
        tags: ['competitor'],
      });
      const bjorn = await mk({
        firstName: 'Björn',
        lastName: 'Holm',
        dateOfBirth: '1992-11-30',
        status: 'active',
        joinDate: '2025-03-01',
      });
      // Kids (Karate).
      const mateo = await mk({
        firstName: 'Mateo',
        lastName: 'Svensson',
        dateOfBirth: '2015-06-01',
        householdId: hhSvensson.id,
        status: 'active',
        joinDate: '2024-09-15',
        tags: ['kids'],
      });
      const wilma = await mk({
        firstName: 'Wilma',
        lastName: 'Karlsson',
        dateOfBirth: '2016-03-22',
        status: 'active',
        joinDate: '2025-02-10',
        tags: ['kids'],
      });
      const noah = await mk({
        firstName: 'Noah',
        lastName: 'Karlsson',
        dateOfBirth: '2018-09-05',
        status: 'active',
        joinDate: '2025-09-01',
        tags: ['kids'],
      });
      // Trial + lead.
      const hugo = await mk({
        firstName: 'Hugo',
        lastName: 'Berg',
        dateOfBirth: '2014-01-15',
        status: 'trial',
        joinDate: NOW,
        tags: ['kids'],
      });
      const lead = await mk({
        firstName: 'Sofia',
        lastName: 'Nyström',
        email: 'sofia@example.com',
        status: 'lead',
      });
      logger.log('Seeded 9 members (4 adults, 3 kids, 1 trial, 1 lead).');

      // Payer wiring + adult logins (so they can sign in to the member app).
      await households.update(hhSvensson.id, { payerMemberId: anna.id });
      const giveMemberLogin = async (m: Member, password: string) => {
        if (!m.email) return null;
        const uid = await loginFor(m.email, password);
        await members.linkUserId(m.id, uid);
        await new MembershipRepository().create({
          userId: uid,
          memberId: m.id,
          roles: [{ role: 'member', locationScope: 'ALL' }],
          status: 'active',
        });
        return uid;
      };
      const annaUserId = await giveMemberLogin(anna, 'change-me-please-12');
      await giveMemberLogin(erik, 'change-me-please-12');
      logger.log('Linked member logins (anna@, erik@ / change-me-please-12).');

      // ── Parents / guardians (§4.10) ──────────────────────────────────────
      const guardianships = new GuardianshipRepository();
      const link = (guardianUserId: string, minorMemberId: string) =>
        guardianships.create({ guardianUserId, minorMemberId, grants: DEFAULT_GUARDIAN_GRANTS });
      // (1) A guardian-only parent — NOT a club member — with TWO kids (Wilma + Noah).
      const pernillaUserId = await loginFor('pernilla@example.com', 'change-me-please-12');
      await new MembershipRepository().create({
        userId: pernillaUserId,
        roles: [{ role: 'guardian', locationScope: 'ALL' }],
        status: 'active',
      });
      await link(pernillaUserId, wilma.id);
      await link(pernillaUserId, noah.id);
      // (2) A parent who is ALSO a member (Anna trains BJJ) and guards her kid Mateo.
      if (annaUserId) await link(annaUserId, mateo.id);
      logger.log(
        'Seeded parents: pernilla@ (guardian-only, 2 kids) + anna@ (member + guardian of Mateo).',
      );

      // ── Rank enrollments + promotion history ─────────────────────────────
      const rankStates = new MemberRankStateRepository();
      const promotions = new PromotionRepository();
      const enrollRank = async (m: Member, disciplineId: string, joinDate: string) => {
        const sys = await ranks.findSystemByDiscipline(disciplineId);
        if (!sys) throw new Error(`no rank system for discipline ${disciplineId}`);
        const ver = await ranks.getCurrentVersion(sys.id);
        if (!ver) throw new Error(`no current version for system ${sys.id}`);
        const state = await rankStates.create({
          memberId: m.id,
          disciplineId,
          systemId: sys.id,
          trackId: ver.tracks[0]!.id,
          currentStepId: null,
          enteredCurrentStepAt: `${joinDate}T00:00:00.000Z`,
        });
        return { state, sys, ver };
      };
      const award = async (
        m: Member,
        disciplineId: string,
        sysId: string,
        versionId: string,
        stateId: string,
        fromStepId: string | null,
        toStepId: string,
        awardedAt: string,
      ) => {
        await promotions.create({
          memberId: m.id,
          disciplineId,
          systemId: sysId,
          systemVersionId: versionId,
          fromStepId,
          toStepId,
          awardedAt,
          awardedByRole: 'owner',
          awardingUserId: ownerUserId,
          satisfiedSnapshot: [],
          overrideReason: 'demo seed — instructor sign-off recorded offline',
        });
        await rankStates.update(stateId, {
          currentStepId: toStepId,
          enteredCurrentStepAt: awardedAt,
        });
      };
      // Anna: white → blue. Erik: white → blue → purple. Mei/Björn: white.
      const annaR = await enrollRank(anna, bjj.id, '2024-09-01');
      await award(
        anna,
        bjj.id,
        annaR.sys.id,
        bjjVersion.versionId,
        annaR.state.id,
        null,
        'white',
        '2024-09-15T00:00:00.000Z',
      );
      await award(
        anna,
        bjj.id,
        annaR.sys.id,
        bjjVersion.versionId,
        annaR.state.id,
        'white',
        'blue',
        '2025-11-01T00:00:00.000Z',
      );
      const erikR = await enrollRank(erik, bjj.id, '2024-10-15');
      await award(
        erik,
        bjj.id,
        erikR.sys.id,
        bjjVersion.versionId,
        erikR.state.id,
        null,
        'white',
        '2024-11-01T00:00:00.000Z',
      );
      await award(
        erik,
        bjj.id,
        erikR.sys.id,
        bjjVersion.versionId,
        erikR.state.id,
        'white',
        'blue',
        '2025-06-01T00:00:00.000Z',
      );
      await award(
        erik,
        bjj.id,
        erikR.sys.id,
        bjjVersion.versionId,
        erikR.state.id,
        'blue',
        'purple',
        '2026-04-01T00:00:00.000Z',
      );
      await enrollRank(mei, bjj.id, '2025-01-10');
      await enrollRank(bjorn, bjj.id, '2025-03-01');
      // Kids: Mateo white→yellow, Wilma white→yellow→orange, Noah white.
      const mateoR = await enrollRank(mateo, karate.id, '2024-09-15');
      await award(
        mateo,
        karate.id,
        mateoR.sys.id,
        karateVersion.versionId,
        mateoR.state.id,
        null,
        'k-white',
        '2024-09-20T00:00:00.000Z',
      );
      await award(
        mateo,
        karate.id,
        mateoR.sys.id,
        karateVersion.versionId,
        mateoR.state.id,
        'k-white',
        'k-yellow',
        '2025-03-01T00:00:00.000Z',
      );
      const wilmaR = await enrollRank(wilma, karate.id, '2025-02-10');
      await award(
        wilma,
        karate.id,
        wilmaR.sys.id,
        karateVersion.versionId,
        wilmaR.state.id,
        null,
        'k-white',
        '2025-02-15T00:00:00.000Z',
      );
      await award(
        wilma,
        karate.id,
        wilmaR.sys.id,
        karateVersion.versionId,
        wilmaR.state.id,
        'k-white',
        'k-yellow',
        '2025-09-01T00:00:00.000Z',
      );
      const noahR = await enrollRank(noah, karate.id, '2025-09-01');
      await award(
        noah,
        karate.id,
        noahR.sys.id,
        karateVersion.versionId,
        noahR.state.id,
        null,
        'k-white',
        '2025-09-10T00:00:00.000Z',
      );
      logger.log('Seeded rank enrollments + promotion history.');

      // ── Programs + schedules + occurrences ───────────────────────────────
      const progBjj = await new ProgramRepository().create({
        name: 'Adults BJJ',
        disciplineId: bjj.id,
        defaultLocationId: locA.id,
        active: true,
      });
      const progKarate = await new ProgramRepository().create({
        name: 'Kids Karate',
        disciplineId: karate.id,
        defaultLocationId: locA.id,
        active: true,
      });
      const schedules = new ClassScheduleRepository();
      const schBjj = await schedules.create({
        programId: progBjj.id,
        locationId: locA.id,
        instructorUserId: ownerUserId,
        rrule: 'FREQ=WEEKLY;BYDAY=MO,WE,FR',
        startTime: '18:00',
        durationMin: 90,
        capacity: 20,
        timezone: 'Europe/Stockholm',
        active: true,
      });
      const schKarate = await schedules.create({
        programId: progKarate.id,
        locationId: locA.id,
        instructorUserId: ownerUserId,
        rrule: 'FREQ=WEEKLY;BYDAY=TU,TH',
        startTime: '17:00',
        durationMin: 60,
        capacity: 15,
        timezone: 'Europe/Stockholm',
        active: true,
      });
      const occurrences = new ClassOccurrenceRepository();
      const expandFor = (sch: { rrule: string; startTime: string; durationMin: number }) =>
        expandWeekly({
          rrule: sch.rrule,
          startTime: sch.startTime,
          durationMin: sch.durationMin,
          timezone: 'Europe/Stockholm',
          seriesStart: '2026-06-01',
          from: '2026-06-08T00:00:00.000Z',
          to: '2026-06-22T00:00:00.000Z',
        });
      const bjjOccs = expandFor(schBjj).map((o) => ({
        scheduleId: schBjj.id,
        programId: progBjj.id,
        locationId: locA.id,
        startsAt: o.startsAt,
        endsAt: o.endsAt,
        capacity: 20,
      }));
      const karateOccs = expandFor(schKarate).map((o) => ({
        scheduleId: schKarate.id,
        programId: progKarate.id,
        locationId: locA.id,
        startsAt: o.startsAt,
        endsAt: o.endsAt,
        capacity: 15,
      }));
      await occurrences.materialize([...bjjOccs, ...karateOccs]);
      logger.log(
        `Seeded programs + schedules + ${bjjOccs.length + karateOccs.length} occurrences (this & next week).`,
      );

      // ── Bookings (upcoming) ──────────────────────────────────────────────
      const bookings = new BookingRepository();
      const upcomingBjj = (await occurrences.list({ scheduleId: schBjj.id }))
        .filter((o) => o.startsAt > `${NOW}T00:00:00.000Z`)
        .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
      if (upcomingBjj[0]) {
        for (const m of [anna, erik, mei, bjorn]) {
          try {
            await bookings.create({
              occurrenceId: upcomingBjj[0].id,
              memberId: m.id,
              status: 'booked',
              bookedAt: `${NOW}T08:00:00.000Z`,
            });
          } catch {
            /* duplicate booking on re-run */
          }
        }
      }
      logger.log('Seeded bookings on the next BJJ class.');

      // ── Attendance (historical — feeds rank eligibility) ─────────────────
      const attendance = new AttendanceRepository();
      const recordHistory = async (
        m: Member,
        disciplineId: string,
        sinceMonth: number,
        count: number,
      ) => {
        for (let i = 0; i < count; i++) {
          const day = String((i % 27) + 1).padStart(2, '0');
          const month = String(((sinceMonth + Math.floor(i / 27)) % 12) + 1).padStart(2, '0');
          await attendance.record({
            memberId: m.id,
            disciplineId,
            programId: null,
            occurrenceId: null,
            locationId: locA.id,
            occurredAt: `2026-${month}-${day}T18:00:00.000Z`,
            method: 'instructor',
          });
        }
      };
      await recordHistory(anna, bjj.id, 0, 40); // ~40 classes toward purple eligibility
      await recordHistory(erik, bjj.id, 3, 25);
      await recordHistory(mei, bjj.id, 0, 12);
      await recordHistory(mateo, karate.id, 2, 18);
      await recordHistory(wilma, karate.id, 0, 22);
      logger.log('Seeded historical attendance (feeds eligibility).');

      // ── Plans + enrollments (MRR) ────────────────────────────────────────
      const plans = new PlanRepository();
      const planAdult = await plans.create({
        name: 'Adult Monthly',
        type: 'recurring',
        price: { amountMinor: 79900, currency: 'SEK' },
        interval: 'monthly',
        vatRateId: vat.id,
        classPackCredits: null,
        active: true,
      });
      const planKids = await plans.create({
        name: 'Kids Monthly',
        type: 'recurring',
        price: { amountMinor: 49900, currency: 'SEK' },
        interval: 'monthly',
        vatRateId: vat.id,
        classPackCredits: null,
        active: true,
      });
      const enrollments = new EnrollmentRepository();
      const subscribe = async (m: Member, planId: string, startDate: string) => {
        const enr = await enrollments.create({
          memberId: m.id,
          planId,
          startDate,
          status: 'active',
        });
        await enrollments.update(enr.id, {
          currentPeriodStart: '2026-06-01',
          currentPeriodEnd: '2026-07-01',
        });
        return enr;
      };
      const annaEnr = await subscribe(anna, planAdult.id, '2024-09-01');
      await subscribe(erik, planAdult.id, '2024-10-15');
      await subscribe(mei, planAdult.id, '2025-01-10');
      await subscribe(bjorn, planAdult.id, '2025-03-01');
      await subscribe(mateo, planKids.id, '2024-09-15');
      await subscribe(wilma, planKids.id, '2025-02-10');
      logger.log('Seeded plans + active enrollments (MRR).');

      // ── Invoices (paid May + overdue June for Anna) — best effort ────────
      try {
        const invoices = new InvoiceRepository();
        const counter = new InvoiceCounterRepository();
        const issueInvoice = async (
          periodStart: string,
          periodEnd: string,
          label: string,
          dueAt: string,
          paid: boolean,
        ) => {
          const line = buildInvoiceLine(label, 1, { amountMinor: 79900, currency: 'SEK' }, 25);
          const totals = invoiceTotals([line], 'SEK');
          const draft = await invoices.create({
            memberId: anna.id,
            enrollmentId: annaEnr.id,
            periodStart,
            periodEnd,
            currency: 'SEK',
            lines: [line],
            subtotal: totals.subtotal,
            vatTotal: totals.vatTotal,
            total: totals.total,
          });
          const number = await counter.allocateInvoiceNumber(tenantId, 2026);
          await invoices.claimForIssueWithNumber(draft.id, {
            issuedAt: `${periodStart}T00:00:00.000Z`,
            dueAt,
            number,
          });
          if (paid)
            await invoices.update(draft.id, {
              status: 'paid',
              paidAt: `${periodStart}T12:00:00.000Z`,
            });
        };
        await issueInvoice(
          '2026-05-01',
          '2026-06-01',
          'Adult Monthly — May 2026',
          '2026-05-05T00:00:00.000Z',
          true,
        );
        await issueInvoice(
          '2026-06-01',
          '2026-07-01',
          'Adult Monthly — June 2026',
          '2026-06-05T00:00:00.000Z',
          false,
        );
        logger.log('Seeded invoices (1 paid, 1 overdue).');
      } catch (err) {
        logger.warn(`Invoice seed skipped: ${err instanceof Error ? err.message : String(err)}`);
      }

      // ── Waiver + signatures ──────────────────────────────────────────────
      const waivers = new WaiverTemplateRepository();
      const waiver = await waivers.create({
        title: 'Mydojo Liability Waiver & Training Agreement',
        bodyMarkdown:
          '# Liability Waiver\n\nI acknowledge the inherent risks of martial-arts training and release the dojo from liability.',
        requiresGuardianForMinor: true,
        active: true,
      });
      const signatures = new WaiverSignatureRepository();
      // Adults self-sign; a minor (Mateo) is guardian-signed by Anna.
      if (annaUserId) {
        await signatures.create({
          templateId: waiver.id,
          templateVersion: 1,
          memberId: anna.id,
          signedByUserId: annaUserId,
          signedByName: 'Anna Svensson',
          isGuardian: false,
          guardianForMemberId: null,
          signedAt: '2024-09-01T10:00:00.000Z',
          ip: null,
          documentStorageKey: null,
        });
        await signatures.create({
          templateId: waiver.id,
          templateVersion: 1,
          memberId: mateo.id,
          signedByUserId: annaUserId,
          signedByName: 'Anna Svensson',
          isGuardian: true,
          guardianForMemberId: mateo.id,
          signedAt: '2024-09-15T10:00:00.000Z',
          ip: null,
          documentStorageKey: null,
        });
      }
      logger.log('Seeded waiver + signatures (adult self-sign + minor guardian-signed).');

      // ── Marketing consent (for broadcast testing) ────────────────────────
      const consent = new ConsentRepository();
      const grantConsent = (subjectId: string) =>
        consent.record({
          tenantId: tenantId as never,
          subjectId: subjectId as never,
          purpose: MARKETING_EMAIL_PURPOSE,
          lawfulBasis: 'consent',
          status: 'granted',
          policyVersion: '2026-06-01',
          grantedAt: new Date('2026-06-01T00:00:00.000Z'),
          withdrawnAt: null,
          source: 'seed-demo',
        });
      if (annaUserId) await grantConsent(annaUserId);
      await grantConsent(pernillaUserId);
      logger.log('Granted marketing consent to anna@ + pernilla@.');

      member(lead); // (lead is referenced for clarity)
      logger.log('✅ Demo dojo seeded.');
    });
  } finally {
    await disconnectMongo();
  }
}

async function main(): Promise<void> {
  const logger = new Logger('seed-demo');
  await seedDemo(loadConfig(process.env), logger);
}

function isMainModule(): boolean {
  const entry = argv[1];
  if (entry === undefined) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(entry);
  } catch {
    return false;
  }
}

if (isMainModule()) {
  void main();
}
