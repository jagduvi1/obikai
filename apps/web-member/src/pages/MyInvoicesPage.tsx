import type { Money } from '@obikai/domain';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getMe, myInvoices } from '../api/member-data';

/** Format integer-minor-unit Money with the active locale (e.g. 49900 SEK → "499,00 kr"). */
function formatMoney(m: Money, locale: string): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency: m.currency }).format(
    m.amountMinor / 100,
  );
}

/** "My invoices": the member's own billing history (self-access GET /invoices?memberId=own). */
export function MyInvoicesPage() {
  const { t, i18n } = useTranslation();
  const me = useQuery({ queryKey: ['me'], queryFn: getMe });
  const memberId = me.data?.memberId ?? null;
  const invoices = useQuery({
    queryKey: ['myInvoices', memberId],
    queryFn: () => myInvoices(memberId as string),
    enabled: !!memberId,
  });

  return (
    <section aria-labelledby="inv-heading">
      <h1 id="inv-heading">{t('invoices.title')}</h1>
      {(me.isLoading || invoices.isLoading) && <p>{t('invoices.loading')}</p>}
      {(me.isError || invoices.isError) && <p className="form-error">{t('invoices.error')}</p>}
      {invoices.data && invoices.data.length === 0 && (
        <p className="muted">{t('invoices.empty')}</p>
      )}
      {invoices.data && invoices.data.length > 0 && (
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">{t('invoices.number')}</th>
              <th scope="col">{t('invoices.status')}</th>
              <th scope="col">{t('invoices.total')}</th>
              <th scope="col">{t('invoices.due')}</th>
            </tr>
          </thead>
          <tbody>
            {invoices.data.map((inv) => (
              <tr key={inv.id}>
                <td>{inv.number ?? '—'}</td>
                <td>{inv.status}</td>
                <td>{formatMoney(inv.total, i18n.language)}</td>
                <td>{inv.dueAt ? new Date(inv.dueAt).toLocaleDateString(i18n.language) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
