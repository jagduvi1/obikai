import {
  DEFAULT_LOCALE,
  type Locale,
  type LocalizedString,
  resolveLocalized,
} from '@obikai/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { listLocations } from '../api/locations';
import { listDisciplines } from '../api/rank';
import {
  createProgram,
  createSchedule,
  listPrograms,
  listSchedules,
  materializeSchedule,
} from '../api/scheduling';
import { WEEKDAYS, type WeekdayCode, buildWeeklyRrule } from '../lib/weekly-rrule';

/** How far ahead "Materialize" expands a schedule's recurrence, in days (4 weeks). */
const MATERIALIZE_HORIZON_DAYS = 28;

/**
 * Classes admin (ADR-0014): define Programs (groupings of classes, optionally tied to a discipline)
 * and recurring ClassSchedules (weekday pattern + time/duration/capacity at a location), then
 * materialize a schedule's recurrence into concrete occurrences. The occurrence calendar + rosters
 * live on their own page.
 */
export function ClassesPage() {
  const { t, i18n } = useTranslation();
  // Discipline names are translatable (H4) — resolve to the viewer's locale.
  const viewer = (i18n.resolvedLanguage ?? i18n.language) as Locale;
  const resolveName = (v: LocalizedString) =>
    resolveLocalized(v, { requested: viewer, defaultLocale: DEFAULT_LOCALE }) ?? '';
  const qc = useQueryClient();

  const disciplines = useQuery({
    queryKey: ['disciplines', 'active'],
    queryFn: () => listDisciplines({ active: true }),
  });
  const locations = useQuery({ queryKey: ['locations'], queryFn: () => listLocations() });
  const programs = useQuery({ queryKey: ['programs'], queryFn: () => listPrograms() });
  const schedules = useQuery({ queryKey: ['schedules'], queryFn: () => listSchedules() });

  const programName = useMemo(() => {
    const map = new Map<string, string>((programs.data ?? []).map((p) => [p.id, p.name]));
    return (id: string) => map.get(id) ?? id;
  }, [programs.data]);
  const locationName = useMemo(() => {
    const map = new Map<string, string>((locations.data ?? []).map((l) => [l.id, l.name]));
    return (id: string) => map.get(id) ?? id;
  }, [locations.data]);

  // ── Program create ────────────────────────────────────────────────────────
  const [program, setProgram] = useState({ name: '', disciplineId: '', defaultLocationId: '' });
  const createProgramM = useMutation({
    mutationFn: () =>
      createProgram({
        name: program.name.trim(),
        disciplineId: program.disciplineId || null,
        defaultLocationId: program.defaultLocationId || null,
        active: true,
      }),
    onSuccess: () => {
      setProgram({ name: '', disciplineId: '', defaultLocationId: '' });
      void qc.invalidateQueries({ queryKey: ['programs'] });
    },
  });
  const programValid = program.name.trim().length > 0;

  // ── Schedule create ───────────────────────────────────────────────────────
  const [schedule, setSchedule] = useState({
    programId: '',
    locationId: '',
    startTime: '18:00',
    durationMin: '60',
    capacity: '20',
    timezone: 'Europe/Stockholm',
  });
  const [days, setDays] = useState<Set<WeekdayCode>>(new Set());
  const rrule = buildWeeklyRrule(days);
  const scheduleValid =
    !!schedule.programId &&
    !!schedule.locationId &&
    rrule.length > 0 &&
    !!schedule.startTime &&
    Number(schedule.durationMin) > 0 &&
    Number(schedule.capacity) > 0 &&
    schedule.timezone.trim().length > 0;

  const createScheduleM = useMutation({
    mutationFn: () =>
      createSchedule({
        programId: schedule.programId,
        locationId: schedule.locationId,
        rrule,
        startTime: schedule.startTime,
        durationMin: Number(schedule.durationMin),
        capacity: Number(schedule.capacity),
        timezone: schedule.timezone.trim(),
        active: true,
      }),
    onSuccess: () => {
      setDays(new Set());
      void qc.invalidateQueries({ queryKey: ['schedules'] });
    },
  });

  const [materializeMsg, setMaterializeMsg] = useState('');
  const materializeM = useMutation({
    mutationFn: (scheduleId: string) => {
      const to = new Date(Date.now() + MATERIALIZE_HORIZON_DAYS * 86_400_000).toISOString();
      return materializeSchedule(scheduleId, { to });
    },
    onSuccess: (occurrences) =>
      setMaterializeMsg(t('classes.materialized', { count: occurrences.length })),
    onError: () => setMaterializeMsg(t('classes.materializeError')),
  });

  function toggleDay(code: WeekdayCode) {
    setDays((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  function formatDays(rule: string): string {
    const match = /BYDAY=([A-Z,]+)/.exec(rule);
    if (!match?.[1]) return rule;
    const codes = match[1].split(',');
    return codes
      .map((c) => {
        const wd = WEEKDAYS.find((w) => w.code === c);
        return wd ? t(`weekday.${wd.labelKey}`) : c;
      })
      .join(' ');
  }

  function onCreateProgram(e: FormEvent) {
    e.preventDefault();
    if (programValid) createProgramM.mutate();
  }
  function onCreateSchedule(e: FormEvent) {
    e.preventDefault();
    if (scheduleValid) createScheduleM.mutate();
  }

  return (
    <div>
      <h1>{t('classes.title')}</h1>

      {/* ── Programs ───────────────────────────────────────────────────────── */}
      <section aria-labelledby="programs-heading">
        <h2 id="programs-heading">{t('classes.programs')}</h2>

        <form className="inline-form" onSubmit={onCreateProgram}>
          <span className="field">
            <label htmlFor="pg-name">{t('classes.programName')}</label>
            <input
              id="pg-name"
              value={program.name}
              onChange={(e) => setProgram({ ...program, name: e.target.value })}
              required
            />
          </span>
          <span className="field">
            <label htmlFor="pg-discipline">{t('classes.discipline')}</label>
            <select
              id="pg-discipline"
              value={program.disciplineId}
              onChange={(e) => setProgram({ ...program, disciplineId: e.target.value })}
            >
              <option value="">{t('classes.none')}</option>
              {(disciplines.data ?? []).map((d) => (
                <option key={d.id} value={d.id}>
                  {resolveName(d.name)}
                </option>
              ))}
            </select>
          </span>
          <span className="field">
            <label htmlFor="pg-location">{t('classes.defaultLocation')}</label>
            <select
              id="pg-location"
              value={program.defaultLocationId}
              onChange={(e) => setProgram({ ...program, defaultLocationId: e.target.value })}
            >
              <option value="">{t('classes.none')}</option>
              {(locations.data ?? []).map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </span>
          <button type="submit" disabled={!programValid || createProgramM.isPending}>
            {t('classes.addProgram')}
          </button>
        </form>
        {createProgramM.isError && <p className="form-error">{t('classes.programError')}</p>}

        {programs.data && programs.data.length === 0 && (
          <p className="muted">{t('classes.noPrograms')}</p>
        )}
        {programs.data && programs.data.length > 0 && (
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">{t('classes.programName')}</th>
                <th scope="col">{t('classes.discipline')}</th>
                <th scope="col">{t('classes.active')}</th>
              </tr>
            </thead>
            <tbody>
              {programs.data.map((p) => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td>
                    {p.disciplineId
                      ? resolveName(
                          (disciplines.data ?? []).find((d) => d.id === p.disciplineId)?.name ?? {},
                        ) || p.disciplineId
                      : '—'}
                  </td>
                  <td>{p.active ? t('common.yes') : t('common.no')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* ── Schedules ──────────────────────────────────────────────────────── */}
      <section aria-labelledby="schedules-heading">
        <h2 id="schedules-heading">{t('classes.schedules')}</h2>

        <form className="inline-form" onSubmit={onCreateSchedule}>
          <span className="field">
            <label htmlFor="sc-program">{t('classes.program')}</label>
            <select
              id="sc-program"
              value={schedule.programId}
              onChange={(e) => setSchedule({ ...schedule, programId: e.target.value })}
              required
            >
              <option value="">{t('classes.selectProgram')}</option>
              {(programs.data ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </span>
          <span className="field">
            <label htmlFor="sc-location">{t('classes.location')}</label>
            <select
              id="sc-location"
              value={schedule.locationId}
              onChange={(e) => setSchedule({ ...schedule, locationId: e.target.value })}
              required
            >
              <option value="">{t('classes.selectLocation')}</option>
              {(locations.data ?? []).map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </span>
          <fieldset className="field weekday-set">
            <legend>{t('classes.days')}</legend>
            {WEEKDAYS.map((w) => (
              <label key={w.code} className="weekday-toggle">
                <input
                  type="checkbox"
                  checked={days.has(w.code)}
                  onChange={() => toggleDay(w.code)}
                />
                {t(`weekday.${w.labelKey}`)}
              </label>
            ))}
          </fieldset>
          <span className="field">
            <label htmlFor="sc-start">{t('classes.startTime')}</label>
            <input
              id="sc-start"
              type="time"
              value={schedule.startTime}
              onChange={(e) => setSchedule({ ...schedule, startTime: e.target.value })}
              required
            />
          </span>
          <span className="field">
            <label htmlFor="sc-duration">{t('classes.durationMin')}</label>
            <input
              id="sc-duration"
              type="number"
              min="1"
              value={schedule.durationMin}
              onChange={(e) => setSchedule({ ...schedule, durationMin: e.target.value })}
              required
            />
          </span>
          <span className="field">
            <label htmlFor="sc-capacity">{t('classes.capacity')}</label>
            <input
              id="sc-capacity"
              type="number"
              min="1"
              value={schedule.capacity}
              onChange={(e) => setSchedule({ ...schedule, capacity: e.target.value })}
              required
            />
          </span>
          <span className="field">
            <label htmlFor="sc-tz">{t('classes.timezone')}</label>
            <input
              id="sc-tz"
              value={schedule.timezone}
              onChange={(e) => setSchedule({ ...schedule, timezone: e.target.value })}
              required
            />
          </span>
          <button type="submit" disabled={!scheduleValid || createScheduleM.isPending}>
            {t('classes.addSchedule')}
          </button>
        </form>
        <p className="muted">
          {t('classes.rulePreview')}: <code>{rrule || '—'}</code>
        </p>
        {createScheduleM.isError && <p className="form-error">{t('classes.scheduleError')}</p>}
        <output className="status">{materializeMsg}</output>

        {schedules.data && schedules.data.length === 0 && (
          <p className="muted">{t('classes.noSchedules')}</p>
        )}
        {schedules.data && schedules.data.length > 0 && (
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">{t('classes.program')}</th>
                <th scope="col">{t('classes.location')}</th>
                <th scope="col">{t('classes.when')}</th>
                <th scope="col">{t('classes.capacity')}</th>
                <th scope="col">{t('classes.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {schedules.data.map((s) => (
                <tr key={s.id}>
                  <td>{programName(s.programId)}</td>
                  <td>{locationName(s.locationId)}</td>
                  <td>
                    {formatDays(s.rrule)} · {s.startTime} · {s.durationMin}
                    {t('classes.minuteAbbrev')}
                  </td>
                  <td>{s.capacity}</td>
                  <td>
                    <button
                      type="button"
                      className="link-button"
                      onClick={() => materializeM.mutate(s.id)}
                      disabled={materializeM.isPending}
                    >
                      {t('classes.materialize')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
