import {
  BILLING_INTERVALS,
  type BillingInterval,
  type Currency,
  PLAN_TYPES,
  type PlanType,
} from '@obikai/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createPlan, formatMoney, listPlans } from '../api/billing';

const CURRENCIES: Currency[] = ['SEK', 'NOK', 'DKK', 'EUR'];

/** Membership-plan templates (ADR-0013). Owner/staff manage; the list drives enrollment + billing. */
export function PlansPage() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const [form, setForm] = useState<{
    name: string;
    type: PlanType;
    price: string;
    currency: Currency;
    interval: BillingInterval;
  }>({ name: '', type: 'recurring', price: '', currency: 'SEK', interval: 'monthly' });

  const plans = useQuery({ queryKey: ['plans'], queryFn: () => listPlans() });
  const create = useMutation({
    mutationFn: () =>
      createPlan({
        name: form.name.trim(),
        type: form.type,
        priceMinor: Math.round(Number(form.price) * 100),
        currency: form.currency,
        interval: form.interval,
      }),
    onSuccess: () => {
      setForm((f) => ({ ...f, name: '', price: '' }));
      void qc.invalidateQueries({ queryKey: ['plans'] });
    },
  });

  const valid = form.name.trim().length > 0 && Number(form.price) >= 0 && form.price !== '';
  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (valid) create.mutate();
  }

  return (
    <section aria-labelledby="plans-heading">
      <h1 id="plans-heading">{t('plans.title')}</h1>

      <form className="inline-form" onSubmit={onSubmit}>
        <span className="field">
          <label htmlFor="p-name">{t('plans.name')}</label>
          <input
            id="p-name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
          />
        </span>
        <span className="field">
          <label htmlFor="p-type">{t('plans.type')}</label>
          <select
            id="p-type"
            value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value as PlanType })}
          >
            {PLAN_TYPES.map((tp) => (
              <option key={tp} value={tp}>
                {tp}
              </option>
            ))}
          </select>
        </span>
        <span className="field">
          <label htmlFor="p-price">{t('plans.price')}</label>
          <input
            id="p-price"
            type="number"
            min="0"
            step="0.01"
            value={form.price}
            onChange={(e) => setForm({ ...form, price: e.target.value })}
            required
          />
        </span>
        <span className="field">
          <label htmlFor="p-currency">{t('plans.currency')}</label>
          <select
            id="p-currency"
            value={form.currency}
            onChange={(e) => setForm({ ...form, currency: e.target.value as Currency })}
          >
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </span>
        <span className="field">
          <label htmlFor="p-interval">{t('plans.interval')}</label>
          <select
            id="p-interval"
            value={form.interval}
            onChange={(e) => setForm({ ...form, interval: e.target.value as BillingInterval })}
          >
            {BILLING_INTERVALS.map((iv) => (
              <option key={iv} value={iv}>
                {iv}
              </option>
            ))}
          </select>
        </span>
        <button type="submit" disabled={!valid || create.isPending}>
          {t('plans.create')}
        </button>
      </form>
      {create.isError && <p className="form-error">{t('plans.createError')}</p>}

      {plans.isLoading && <p>{t('plans.loading')}</p>}
      {plans.data && plans.data.length === 0 && <p className="muted">{t('plans.empty')}</p>}
      {plans.data && plans.data.length > 0 && (
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">{t('plans.name')}</th>
              <th scope="col">{t('plans.type')}</th>
              <th scope="col">{t('plans.interval')}</th>
              <th scope="col">{t('plans.price')}</th>
            </tr>
          </thead>
          <tbody>
            {plans.data.map((p) => (
              <tr key={p.id}>
                <td>{p.name}</td>
                <td>{p.type}</td>
                <td>{p.interval}</td>
                <td>{formatMoney(p.price, i18n.language)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
