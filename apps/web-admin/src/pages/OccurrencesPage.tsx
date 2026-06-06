import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { listLocations } from '../api/locations';
import { listOccurrences, listPrograms } from '../api/scheduling';

/** Default look-ahead window for the occurrence calendar, in days. */
const DEFAULT_HORIZON_DAYS = 14;

function isoOffsetDays(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

/**
 * Occurrence calendar (ADR-0014): the materialized class instances over a date window, filterable by
 * location. Each row links to the occurrence's roster + attendance. Read-heavy; mutations live on the
 * detail page.
 */
export function OccurrencesPage() {
  const { t, i18n } = useTranslation();
  const [locationId, setLocationId] = useState('');
  // The window is fixed (now → horizon) for v1; from/to pickers can come later.
  const range = useMemo(
    () => ({ from: isoOffsetDays(0), to: isoOffsetDays(DEFAULT_HORIZON_DAYS) }),
    [],
  );

  const locations = useQuery({ queryKey: ['locations'], queryFn: () => listLocations() });
  const programs = useQuery({ queryKey: ['programs'], queryFn: () => listPrograms() });
  const occurrences = useQuery({
    queryKey: ['occurrences', range.from, range.to, locationId],
    queryFn: () => listOccurrences(locationId ? { ...range, locationId } : range),
  });

  const programName = useMemo(() => {
    const map = new Map<string, string>((programs.data ?? []).map((p) => [p.id, p.name]));
    return (id: string) => map.get(id) ?? id;
  }, [programs.data]);
  const locationName = useMemo(() => {
    const map = new Map<string, string>((locations.data ?? []).map((l) => [l.id, l.name]));
    return (id: string) => map.get(id) ?? id;
  }, [locations.data]);

  return (
    <section aria-labelledby="occ-heading">
      <h1 id="occ-heading">{t('occurrences.title')}</h1>
      <p className="muted">{t('occurrences.window', { days: DEFAULT_HORIZON_DAYS })}</p>

      <form className="inline-form" aria-label={t('occurrences.filters')}>
        <span className="field">
          <label htmlFor="occ-location">{t('occurrences.location')}</label>
          <select
            id="occ-location"
            value={locationId}
            onChange={(e) => setLocationId(e.target.value)}
          >
            <option value="">{t('occurrences.allLocations')}</option>
            {(locations.data ?? []).map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </span>
      </form>

      {occurrences.isLoading && <p>{t('occurrences.loading')}</p>}
      {occurrences.isError && <p className="form-error">{t('occurrences.error')}</p>}
      {occurrences.data && occurrences.data.length === 0 && (
        <p className="muted">{t('occurrences.empty')}</p>
      )}
      {occurrences.data && occurrences.data.length > 0 && (
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">{t('occurrences.when')}</th>
              <th scope="col">{t('occurrences.program')}</th>
              <th scope="col">{t('occurrences.location')}</th>
              <th scope="col">{t('occurrences.capacity')}</th>
              <th scope="col">{t('occurrences.status')}</th>
            </tr>
          </thead>
          <tbody>
            {occurrences.data.map((o) => (
              <tr key={o.id}>
                <td>
                  <Link to={`/occurrences/${o.id}`}>
                    {new Date(o.startsAt).toLocaleString(i18n.language)}
                  </Link>
                </td>
                <td>{programName(o.programId)}</td>
                <td>{locationName(o.locationId)}</td>
                <td>{o.capacity}</td>
                <td>{t(`occurrences.statusValue.${o.status}`)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
