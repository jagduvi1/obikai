import type { BillingProfileInput } from '@obikai/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getBillingProfile, saveBillingProfile } from '../api/settings';

type FormState = {
  legalName: string;
  vatId: string;
  registrationNumber: string;
  addressLine1: string;
  addressLine2: string;
  postalCode: string;
  city: string;
  country: string;
  email: string;
  paymentDetails: string;
  footerNote: string;
};

const EMPTY: FormState = {
  legalName: '',
  vatId: '',
  registrationNumber: '',
  addressLine1: '',
  addressLine2: '',
  postalCode: '',
  city: '',
  country: '',
  email: '',
  paymentDetails: '',
  footerNote: '',
};

/** Trim a field to its value, or null when blank (PUT semantics: blank clears the field). */
const orNull = (s: string): string | null => (s.trim() === '' ? null : s.trim());

/**
 * Seller billing profile settings (ADR-0018): the dojo's legal/tax identity printed on invoices.
 * Owner-editable; the form pre-fills from the saved profile and PUTs the whole profile on save.
 */
export function SettingsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [form, setForm] = useState<FormState>(EMPTY);

  const profile = useQuery({ queryKey: ['billingProfile'], queryFn: () => getBillingProfile() });

  // Pre-fill the form once the saved profile loads (null fields → empty inputs).
  useEffect(() => {
    const p = profile.data;
    if (!p) return;
    setForm({
      legalName: p.legalName,
      vatId: p.vatId ?? '',
      registrationNumber: p.registrationNumber ?? '',
      addressLine1: p.addressLine1 ?? '',
      addressLine2: p.addressLine2 ?? '',
      postalCode: p.postalCode ?? '',
      city: p.city ?? '',
      country: p.country ?? '',
      email: p.email ?? '',
      paymentDetails: p.paymentDetails ?? '',
      footerNote: p.footerNote ?? '',
    });
  }, [profile.data]);

  const save = useMutation({
    mutationFn: (): Promise<unknown> => {
      const input: BillingProfileInput = {
        legalName: form.legalName.trim(),
        vatId: orNull(form.vatId),
        registrationNumber: orNull(form.registrationNumber),
        addressLine1: orNull(form.addressLine1),
        addressLine2: orNull(form.addressLine2),
        postalCode: orNull(form.postalCode),
        city: orNull(form.city),
        country: form.country.trim() === '' ? null : form.country.trim().toUpperCase(),
        email: orNull(form.email),
        paymentDetails: orNull(form.paymentDetails),
        footerNote: orNull(form.footerNote),
      };
      return saveBillingProfile(input);
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['billingProfile'] }),
  });

  const valid = form.legalName.trim().length > 0;
  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (valid) save.mutate();
  }
  const set = (k: keyof FormState) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <section aria-labelledby="settings-heading">
      <h1 id="settings-heading">{t('settings.title')}</h1>
      <p className="muted">{t('settings.intro')}</p>

      {profile.isLoading && <p>{t('settings.loading')}</p>}

      <form className="stacked-form" onSubmit={onSubmit}>
        <span className="field">
          <label htmlFor="s-legalName">{t('settings.legalName')}</label>
          <input id="s-legalName" value={form.legalName} onChange={set('legalName')} required />
        </span>
        <div className="field-row">
          <span className="field">
            <label htmlFor="s-vatId">{t('settings.vatId')}</label>
            <input id="s-vatId" value={form.vatId} onChange={set('vatId')} />
          </span>
          <span className="field">
            <label htmlFor="s-reg">{t('settings.registrationNumber')}</label>
            <input
              id="s-reg"
              value={form.registrationNumber}
              onChange={set('registrationNumber')}
            />
          </span>
        </div>
        <span className="field">
          <label htmlFor="s-addr1">{t('settings.addressLine1')}</label>
          <input id="s-addr1" value={form.addressLine1} onChange={set('addressLine1')} />
        </span>
        <span className="field">
          <label htmlFor="s-addr2">{t('settings.addressLine2')}</label>
          <input id="s-addr2" value={form.addressLine2} onChange={set('addressLine2')} />
        </span>
        <div className="field-row">
          <span className="field">
            <label htmlFor="s-postal">{t('settings.postalCode')}</label>
            <input id="s-postal" value={form.postalCode} onChange={set('postalCode')} />
          </span>
          <span className="field">
            <label htmlFor="s-city">{t('settings.city')}</label>
            <input id="s-city" value={form.city} onChange={set('city')} />
          </span>
          <span className="field">
            <label htmlFor="s-country">{t('settings.country')}</label>
            <input
              id="s-country"
              value={form.country}
              onChange={set('country')}
              maxLength={2}
              placeholder="SE"
            />
          </span>
        </div>
        <span className="field">
          <label htmlFor="s-email">{t('settings.email')}</label>
          <input id="s-email" type="email" value={form.email} onChange={set('email')} />
        </span>
        <span className="field">
          <label htmlFor="s-pay">{t('settings.paymentDetails')}</label>
          <textarea
            id="s-pay"
            rows={3}
            value={form.paymentDetails}
            onChange={set('paymentDetails')}
          />
        </span>
        <span className="field">
          <label htmlFor="s-footer">{t('settings.footerNote')}</label>
          <textarea id="s-footer" rows={2} value={form.footerNote} onChange={set('footerNote')} />
        </span>

        <div>
          <button type="submit" disabled={!valid || save.isPending}>
            {t('settings.save')}
          </button>
        </div>
      </form>
      {save.isError && <p className="form-error">{t('settings.saveError')}</p>}
      <output className="status">{save.isSuccess ? t('settings.saved') : ''}</output>
    </section>
  );
}
