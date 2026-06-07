import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { listAudit } from '../api/platform';

/** The tamper-evident platform audit log (ADR-0023/0024). Newest first for readability. */
export function AuditPage() {
  const { t, i18n } = useTranslation();
  const audit = useQuery({ queryKey: ['platform', 'audit'], queryFn: () => listAudit() });

  // The api returns oldest→newest (chain order); show newest first for the operator.
  const rows = audit.data ? [...audit.data].reverse() : [];

  return (
    <section aria-labelledby="audit-heading">
      <h1 id="audit-heading">{t('audit.title')}</h1>
      <p className="muted">{t('audit.intro')}</p>

      {audit.isLoading && <p>{t('audit.loading')}</p>}
      {audit.isError && <p className="form-error">{t('audit.error')}</p>}
      {audit.data && audit.data.length === 0 && <p className="muted">{t('audit.empty')}</p>}
      {rows.length > 0 && (
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">{t('audit.when')}</th>
              <th scope="col">{t('audit.actor')}</th>
              <th scope="col">{t('audit.action')}</th>
              <th scope="col">{t('audit.target')}</th>
              <th scope="col">{t('audit.ip')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.hash}>
                <td>{new Date(e.ts).toLocaleString(i18n.language)}</td>
                <td>{e.actorUserId ?? '—'}</td>
                <td>
                  <code>{e.action}</code>
                </td>
                <td>{e.targetId}</td>
                <td>{e.ip ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
