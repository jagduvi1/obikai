import { MEMBER_STATUSES, type MemberCreateInput, type MemberStatus } from '@obikai/domain';
import { type FormEvent, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

/** Editable member fields (all strings while in the form; converted to the API input on submit). */
export interface MemberFormValues {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  dateOfBirth: string;
  status: MemberStatus;
  notes: string;
  /** Comma-separated tags while editing; split to an array on submit. */
  tags: string;
}

const EMPTY: MemberFormValues = {
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  dateOfBirth: '',
  status: 'lead',
  notes: '',
  tags: '',
};

/** Trim → value, or null when blank (the API treats null as "clear/unset"). */
const orNull = (s: string): string | null => (s.trim() === '' ? null : s.trim());

/** Split a comma-separated tag string into a trimmed, non-empty array (server re-normalizes/dedupes). */
function splitTags(s: string): string[] {
  return s
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

/** Convert the form's string state into the validated create/update DTO shape. */
function toInput(v: MemberFormValues): MemberCreateInput {
  return {
    firstName: v.firstName.trim(),
    lastName: v.lastName.trim(),
    email: orNull(v.email),
    phone: orNull(v.phone),
    dateOfBirth: orNull(v.dateOfBirth),
    status: v.status,
    notes: orNull(v.notes),
    tags: splitTags(v.tags),
  };
}

/**
 * Shared, accessible member form (create + edit). Controlled inputs with explicit labels; the parent
 * owns the mutation and passes `pending`/`error`/`onSubmit`. firstName + lastName are required.
 */
export function MemberForm({
  initial,
  submitLabel,
  pending,
  error,
  onSubmit,
}: {
  initial?: Partial<MemberFormValues>;
  submitLabel: string;
  pending: boolean;
  error: boolean;
  onSubmit: (input: MemberCreateInput) => void;
}) {
  const { t } = useTranslation();
  const ids = {
    first: useId(),
    last: useId(),
    email: useId(),
    phone: useId(),
    dob: useId(),
    status: useId(),
    notes: useId(),
    tags: useId(),
  };
  const [form, setForm] = useState<MemberFormValues>({ ...EMPTY, ...initial });
  const set = (k: keyof MemberFormValues) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const valid = form.firstName.trim() !== '' && form.lastName.trim() !== '';

  function submit(e: FormEvent) {
    e.preventDefault();
    if (valid) onSubmit(toInput(form));
  }

  return (
    <form
      className="stacked-form"
      onSubmit={submit}
      aria-describedby={error ? 'member-form-error' : undefined}
    >
      {error && (
        <p id="member-form-error" role="alert" className="form-error">
          {t('memberForm.saveError')}
        </p>
      )}
      <div className="field-row">
        <span className="field">
          <label htmlFor={ids.first}>{t('memberForm.firstName')}</label>
          <input id={ids.first} value={form.firstName} onChange={set('firstName')} required />
        </span>
        <span className="field">
          <label htmlFor={ids.last}>{t('memberForm.lastName')}</label>
          <input id={ids.last} value={form.lastName} onChange={set('lastName')} required />
        </span>
      </div>
      <div className="field-row">
        <span className="field">
          <label htmlFor={ids.email}>{t('memberForm.email')}</label>
          <input id={ids.email} type="email" value={form.email} onChange={set('email')} />
        </span>
        <span className="field">
          <label htmlFor={ids.phone}>{t('memberForm.phone')}</label>
          <input id={ids.phone} value={form.phone} onChange={set('phone')} />
        </span>
      </div>
      <div className="field-row">
        <span className="field">
          <label htmlFor={ids.dob}>{t('memberForm.dateOfBirth')}</label>
          <input id={ids.dob} type="date" value={form.dateOfBirth} onChange={set('dateOfBirth')} />
        </span>
        <span className="field">
          <label htmlFor={ids.status}>{t('memberForm.status')}</label>
          <select id={ids.status} value={form.status} onChange={set('status')}>
            {MEMBER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`memberForm.statusValue.${s}`)}
              </option>
            ))}
          </select>
        </span>
      </div>
      <span className="field">
        <label htmlFor={ids.tags}>{t('memberForm.tags')}</label>
        <input
          id={ids.tags}
          value={form.tags}
          onChange={set('tags')}
          aria-describedby={`${ids.tags}-help`}
        />
        <small id={`${ids.tags}-help`} className="field-help">
          {t('memberForm.tagsHelp')}
        </small>
      </span>
      <span className="field">
        <label htmlFor={ids.notes}>{t('memberForm.notes')}</label>
        <textarea id={ids.notes} rows={2} value={form.notes} onChange={set('notes')} />
      </span>
      <div>
        <button type="submit" disabled={!valid || pending}>
          {submitLabel}
        </button>
      </div>
    </form>
  );
}
