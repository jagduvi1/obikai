import type { Member, MemberProfileUpdateInput } from '@obikai/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getMyProfile, updateMyProfile } from '../api/member-data';

/** Trim → value, or null when blank (the API treats null as "clear/unset"). */
const orNull = (s: string): string | null => (s.trim() === '' ? null : s.trim());

interface FormValues {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  dateOfBirth: string;
  ecName: string;
  ecPhone: string;
  ecRelation: string;
}

function toPatch(v: FormValues): MemberProfileUpdateInput {
  const ec =
    v.ecName.trim() === '' && v.ecPhone.trim() === ''
      ? null
      : { name: v.ecName.trim(), phone: v.ecPhone.trim(), relation: orNull(v.ecRelation) };
  return {
    firstName: v.firstName.trim(),
    lastName: v.lastName.trim(),
    email: orNull(v.email),
    phone: orNull(v.phone),
    dateOfBirth: orNull(v.dateOfBirth),
    emergencyContact: ec,
  };
}

/** Editable profile form, mounted with the loaded member so its state initializes once. */
function ProfileForm({ member }: { member: Member }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const ids = {
    first: useId(),
    last: useId(),
    email: useId(),
    phone: useId(),
    dob: useId(),
    ecName: useId(),
    ecPhone: useId(),
    ecRelation: useId(),
  };
  const [form, setForm] = useState<FormValues>({
    firstName: member.firstName,
    lastName: member.lastName,
    email: member.email ?? '',
    phone: member.phone ?? '',
    dateOfBirth: member.dateOfBirth ?? '',
    ecName: member.emergencyContact?.name ?? '',
    ecPhone: member.emergencyContact?.phone ?? '',
    ecRelation: member.emergencyContact?.relation ?? '',
  });
  const set = (k: keyof FormValues) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = useMutation({
    mutationFn: () => updateMyProfile(toPatch(form)),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['myProfile'] }),
  });

  const valid = form.firstName.trim() !== '' && form.lastName.trim() !== '';
  function submit(e: FormEvent) {
    e.preventDefault();
    if (valid) save.mutate();
  }

  return (
    <form className="stacked-form" onSubmit={submit}>
      <output className="status">{save.isSuccess ? t('profile.saved') : ''}</output>
      {save.isError && (
        <p role="alert" className="form-error">
          {t('profile.saveError')}
        </p>
      )}
      <div className="field-row">
        <span className="field">
          <label htmlFor={ids.first}>{t('profile.firstName')}</label>
          <input id={ids.first} value={form.firstName} onChange={set('firstName')} required />
        </span>
        <span className="field">
          <label htmlFor={ids.last}>{t('profile.lastName')}</label>
          <input id={ids.last} value={form.lastName} onChange={set('lastName')} required />
        </span>
      </div>
      <div className="field-row">
        <span className="field">
          <label htmlFor={ids.email}>{t('profile.email')}</label>
          <input id={ids.email} type="email" value={form.email} onChange={set('email')} />
        </span>
        <span className="field">
          <label htmlFor={ids.phone}>{t('profile.phone')}</label>
          <input id={ids.phone} value={form.phone} onChange={set('phone')} />
        </span>
      </div>
      <span className="field">
        <label htmlFor={ids.dob}>{t('profile.dateOfBirth')}</label>
        <input id={ids.dob} type="date" value={form.dateOfBirth} onChange={set('dateOfBirth')} />
      </span>
      <fieldset>
        <legend>{t('profile.emergencyContact')}</legend>
        <div className="field-row">
          <span className="field">
            <label htmlFor={ids.ecName}>{t('profile.ecName')}</label>
            <input id={ids.ecName} value={form.ecName} onChange={set('ecName')} />
          </span>
          <span className="field">
            <label htmlFor={ids.ecPhone}>{t('profile.ecPhone')}</label>
            <input id={ids.ecPhone} value={form.ecPhone} onChange={set('ecPhone')} />
          </span>
        </div>
        <span className="field">
          <label htmlFor={ids.ecRelation}>{t('profile.ecRelation')}</label>
          <input id={ids.ecRelation} value={form.ecRelation} onChange={set('ecRelation')} />
        </span>
      </fieldset>
      <div>
        <button type="submit" disabled={!valid || save.isPending}>
          {t('profile.save')}
        </button>
      </div>
    </form>
  );
}

/** "My profile" (§4.6) — the member edits their own contact + emergency-contact details. */
export function ProfilePage() {
  const { t } = useTranslation();
  const profile = useQuery({ queryKey: ['myProfile'], queryFn: getMyProfile });

  return (
    <section aria-labelledby="profile-heading">
      <h1 id="profile-heading">{t('profile.title')}</h1>
      {profile.isLoading && <p>{t('profile.loading')}</p>}
      {profile.isError && (
        <p role="alert" className="form-error">
          {t('profile.error')}
        </p>
      )}
      {profile.data && <ProfileForm member={profile.data} />}
    </section>
  );
}
