import type { ReportMoney } from '@obikai/domain';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getOwnerDashboard } from '../api/reporting';

/** Format a list of per-currency amounts (minor units) for the active locale; "—" when empty. */
function formatMoneyList(amounts: readonly ReportMoney[], locale: string): string {
  if (amounts.length === 0) return '—';
  return amounts
    .map((m) =>
      new Intl.NumberFormat(locale, { style: 'currency', currency: m.currency }).format(
        m.amountMinor / 100,
      ),
    )
    .join(' · ');
}

/**
 * Owner dashboard (§4.9) — the action-oriented home: at-risk members, payments to recover, this
 * month's growth, MRR, and an attendance trend. Numbers come from tenant-guarded aggregations.
 */
export function DashboardPage() {
  const { t, i18n } = useTranslation();
  const dash = useQuery({ queryKey: ['ownerDashboard'], queryFn: getOwnerDashboard });

  if (dash.isLoading) return <p>{t('dashboard.loading')}</p>;
  if (dash.isError || !dash.data)
    return (
      <p role="alert" className="form-error">
        {t('dashboard.error')}
      </p>
    );
  const d = dash.data;
  const maxTrend = Math.max(1, ...d.attendanceTrend.map((m) => m.count));

  const cards: { key: string; label: string; value: string | number; alert?: boolean }[] = [
    { key: 'atRisk', label: t('dashboard.atRisk'), value: d.atRisk, alert: d.atRisk > 0 },
    {
      key: 'toRecover',
      label: t('dashboard.toRecover'),
      value: d.revenue.toRecover,
      alert: d.revenue.toRecover > 0,
    },
    { key: 'newThisMonth', label: t('dashboard.newThisMonth'), value: d.members.newThisMonth },
    { key: 'active', label: t('dashboard.activeMembers'), value: d.members.active },
    { key: 'mrr', label: t('dashboard.mrr'), value: formatMoneyList(d.revenue.mrr, i18n.language) },
    {
      key: 'outstanding',
      label: t('dashboard.outstanding'),
      value: formatMoneyList(d.revenue.outstanding, i18n.language),
    },
  ];

  return (
    <section aria-labelledby="dashboard-heading">
      <h1 id="dashboard-heading">{t('dashboard.title')}</h1>

      <ul className="stat-cards">
        {cards.map((c) => (
          <li key={c.key} className={c.alert ? 'stat-card stat-card--alert' : 'stat-card'}>
            <span className="stat-card__value">{c.value}</span>
            <span className="stat-card__label">{c.label}</span>
          </li>
        ))}
      </ul>

      <h2>{t('dashboard.attendanceTrend')}</h2>
      {d.attendanceTrend.length === 0 ? (
        <p className="muted">{t('dashboard.noAttendance')}</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">{t('dashboard.month')}</th>
              <th scope="col">{t('dashboard.checkIns')}</th>
            </tr>
          </thead>
          <tbody>
            {d.attendanceTrend.map((m) => (
              <tr key={m.month}>
                <td>{m.month}</td>
                <td>
                  <span
                    className="bar"
                    aria-hidden="true"
                    style={{ inlineSize: `${Math.round((m.count / maxTrend) * 100)}%` }}
                  />
                  {m.count}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
