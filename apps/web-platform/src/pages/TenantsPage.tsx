import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { listTenants } from '../api/platform';

/** Cross-tenant registry list (ADR-0024). Read-only; each row links to the tenant's detail. */
export function TenantsPage() {
  const { t, i18n } = useTranslation();
  const tenants = useQuery({ queryKey: ['platform', 'tenants'], queryFn: () => listTenants() });

  return (
    <section aria-labelledby="tenants-heading">
      <h1 id="tenants-heading">{t('tenants.title')}</h1>

      {tenants.isLoading && <p>{t('tenants.loading')}</p>}
      {tenants.isError && <p className="form-error">{t('tenants.error')}</p>}
      {tenants.data && tenants.data.length === 0 && <p className="muted">{t('tenants.empty')}</p>}
      {tenants.data && tenants.data.length > 0 && (
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">{t('tenants.slug')}</th>
              <th scope="col">{t('tenants.name')}</th>
              <th scope="col">{t('tenants.status')}</th>
              <th scope="col">{t('tenants.created')}</th>
            </tr>
          </thead>
          <tbody>
            {tenants.data.map((tenant) => (
              <tr key={tenant.slug}>
                <td>
                  <Link to={`/tenants/${tenant.slug}`}>{tenant.slug}</Link>
                </td>
                <td>{tenant.name}</td>
                <td>{t(`statusValue.${tenant.status}`)}</td>
                <td>{new Date(tenant.createdAt).toLocaleDateString(i18n.language)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
