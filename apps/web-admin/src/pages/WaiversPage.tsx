import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createWaiverTemplate, listWaiverTemplates, updateWaiverTemplate } from '../api/waivers';

/**
 * Waiver template management (scope §4.10). Templates are VERSIONED server-side — editing the body
 * mints a new version while existing signatures stay pinned to the version they were signed under — so
 * the admin only sees the current version and never manages versioning by hand.
 */
export function WaiversPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [form, setForm] = useState({ title: '', bodyMarkdown: '', requiresGuardianForMinor: true });

  const templates = useQuery({
    queryKey: ['waiverTemplates'],
    queryFn: () => listWaiverTemplates(),
  });

  const create = useMutation({
    mutationFn: () =>
      createWaiverTemplate({
        title: form.title.trim(),
        bodyMarkdown: form.bodyMarkdown.trim(),
        requiresGuardianForMinor: form.requiresGuardianForMinor,
        active: true,
      }),
    onSuccess: () => {
      setForm({ title: '', bodyMarkdown: '', requiresGuardianForMinor: true });
      void qc.invalidateQueries({ queryKey: ['waiverTemplates'] });
    },
  });

  const setActive = useMutation({
    mutationFn: (vars: { id: string; active: boolean }) =>
      updateWaiverTemplate(vars.id, { active: vars.active }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['waiverTemplates'] }),
  });

  const valid = form.title.trim().length > 0 && form.bodyMarkdown.trim().length > 0;
  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (valid) create.mutate();
  }

  return (
    <section aria-labelledby="waivers-heading">
      <h1 id="waivers-heading">{t('waivers.title')}</h1>
      <p className="muted">{t('waivers.intro')}</p>

      <form className="stacked-form" onSubmit={onSubmit}>
        <span className="field">
          <label htmlFor="w-title">{t('waivers.templateTitle')}</label>
          <input
            id="w-title"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            required
          />
        </span>
        <span className="field">
          <label htmlFor="w-body">{t('waivers.body')}</label>
          <textarea
            id="w-body"
            rows={6}
            value={form.bodyMarkdown}
            onChange={(e) => setForm({ ...form, bodyMarkdown: e.target.value })}
            required
          />
        </span>
        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={form.requiresGuardianForMinor}
            onChange={(e) => setForm({ ...form, requiresGuardianForMinor: e.target.checked })}
          />
          {t('waivers.requiresGuardian')}
        </label>
        <div>
          <button type="submit" disabled={!valid || create.isPending}>
            {t('waivers.create')}
          </button>
        </div>
      </form>
      {create.isError && <p className="form-error">{t('waivers.createError')}</p>}

      {templates.isLoading && <p>{t('waivers.loading')}</p>}
      {templates.isError && <p className="form-error">{t('waivers.error')}</p>}
      {templates.data && templates.data.length === 0 && (
        <p className="muted">{t('waivers.empty')}</p>
      )}
      {templates.data && templates.data.length > 0 && (
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">{t('waivers.templateTitle')}</th>
              <th scope="col">{t('waivers.version')}</th>
              <th scope="col">{t('waivers.guardian')}</th>
              <th scope="col">{t('waivers.status')}</th>
              <th scope="col">{t('waivers.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {templates.data.map((w) => (
              <tr key={w.id}>
                <td>{w.title}</td>
                <td>v{w.version}</td>
                <td>{w.requiresGuardianForMinor ? t('common.yes') : t('common.no')}</td>
                <td>{w.active ? t('waivers.active') : t('waivers.inactive')}</td>
                <td>
                  <button
                    type="button"
                    className="link-button"
                    disabled={setActive.isPending}
                    onClick={() => setActive.mutate({ id: w.id, active: !w.active })}
                  >
                    {w.active ? t('waivers.deactivate') : t('waivers.activate')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
