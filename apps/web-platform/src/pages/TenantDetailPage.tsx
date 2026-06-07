import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { getTenant, getTenantUsage } from '../api/platform';

/** One tenant's registry record + usage counts (ADR-0024). Read-only oversight. */
export function TenantDetailPage() {
  const { t, i18n } = useTranslation();
  const { slug = '' } = useParams();

  const tenant = useQuery({
    queryKey: ['platform', 'tenant', slug],
    queryFn: () => getTenant(slug),
    enabled: !!slug,
  });
  const usage = useQuery({
    queryKey: ['platform', 'usage', slug],
    queryFn: () => getTenantUsage(slug),
    enabled: !!slug,
  });

  return (
    <div>
      <p>
        <Link to="/tenants">← {t('tenant.back')}</Link>
      </p>

      {tenant.isLoading && <p>{t('tenant.loading')}</p>}
      {tenant.isError && <p className="form-error">{t('tenant.error')}</p>}

      {tenant.data && (
        <>
          <h1>{tenant.data.name}</h1>
          <dl className="meta">
            <div>
              <dt>{t('tenant.slug')}</dt>
              <dd>{tenant.data.slug}</dd>
            </div>
            <div>
              <dt>{t('tenant.status')}</dt>
              <dd>{t(`statusValue.${tenant.data.status}`)}</dd>
            </div>
            <div>
              <dt>{t('tenant.created')}</dt>
              <dd>{new Date(tenant.data.createdAt).toLocaleDateString(i18n.language)}</dd>
            </div>
          </dl>

          <section aria-labelledby="usage-heading">
            <h2 id="usage-heading">{t('tenant.usage')}</h2>
            {usage.isLoading && <p>{t('tenant.loading')}</p>}
            {usage.isError && <p className="form-error">{t('tenant.error')}</p>}
            {usage.data && (
              <dl className="meta">
                <div>
                  <dt>{t('tenant.members')}</dt>
                  <dd>{usage.data.members}</dd>
                </div>
                <div>
                  <dt>{t('tenant.activeMembers')}</dt>
                  <dd>{usage.data.activeMembers}</dd>
                </div>
              </dl>
            )}
          </section>
        </>
      )}
    </div>
  );
}
