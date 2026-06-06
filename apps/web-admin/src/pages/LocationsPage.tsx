import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createLocation, listLocations } from '../api/locations';

/** Physical dojo locations (ADR-0011). Each pins a timezone used for scheduling/attendance times. */
export function LocationsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: '', timezone: 'Europe/Stockholm', address: '' });

  const locations = useQuery({ queryKey: ['locations'], queryFn: () => listLocations() });
  const create = useMutation({
    mutationFn: () =>
      createLocation({
        name: form.name.trim(),
        timezone: form.timezone.trim(),
        address: form.address.trim() || null,
      }),
    onSuccess: () => {
      setForm((f) => ({ ...f, name: '', address: '' }));
      void qc.invalidateQueries({ queryKey: ['locations'] });
    },
  });

  const valid = form.name.trim().length > 0 && form.timezone.trim().length > 0;
  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (valid) create.mutate();
  }

  return (
    <section aria-labelledby="locations-heading">
      <h1 id="locations-heading">{t('locations.title')}</h1>

      <form className="inline-form" onSubmit={onSubmit}>
        <span className="field">
          <label htmlFor="l-name">{t('locations.name')}</label>
          <input
            id="l-name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
          />
        </span>
        <span className="field">
          <label htmlFor="l-tz">{t('locations.timezone')}</label>
          <input
            id="l-tz"
            value={form.timezone}
            onChange={(e) => setForm({ ...form, timezone: e.target.value })}
            required
          />
        </span>
        <span className="field">
          <label htmlFor="l-address">{t('locations.address')}</label>
          <input
            id="l-address"
            value={form.address}
            onChange={(e) => setForm({ ...form, address: e.target.value })}
          />
        </span>
        <button type="submit" disabled={!valid || create.isPending}>
          {t('locations.create')}
        </button>
      </form>
      {create.isError && <p className="form-error">{t('locations.createError')}</p>}

      {locations.isLoading && <p>{t('locations.loading')}</p>}
      {locations.data && locations.data.length === 0 && (
        <p className="muted">{t('locations.empty')}</p>
      )}
      {locations.data && locations.data.length > 0 && (
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">{t('locations.name')}</th>
              <th scope="col">{t('locations.timezone')}</th>
              <th scope="col">{t('locations.address')}</th>
            </tr>
          </thead>
          <tbody>
            {locations.data.map((l) => (
              <tr key={l.id}>
                <td>{l.name}</td>
                <td>{l.timezone}</td>
                <td>{l.address ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
