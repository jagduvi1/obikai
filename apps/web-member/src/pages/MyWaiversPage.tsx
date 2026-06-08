import type { MemberWaiverStatus } from '@obikai/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getMe, myWaiverStatus, signWaiver } from '../api/member-data';

/**
 * "Waivers": the member reads each active waiver and signs it digitally (a typed full name + an
 * explicit "I agree" — no uploaded document). The signature is dated and immutable server-side; if a
 * waiver is later revised, it reappears here for the member to re-sign (ADR-0014, scope §4.10).
 */
export function MyWaiversPage() {
  const { t } = useTranslation();
  const me = useQuery({ queryKey: ['me'], queryFn: getMe });
  const memberId = me.data?.memberId ?? null;
  const status = useQuery({
    queryKey: ['myWaiverStatus', memberId],
    queryFn: () => myWaiverStatus(memberId as string),
    enabled: !!memberId,
  });

  const pending = status.data?.filter((w) => !w.signed) ?? [];
  const signed = status.data?.filter((w) => w.signed) ?? [];

  return (
    <section aria-labelledby="waivers-heading">
      <h1 id="waivers-heading">{t('waivers.title')}</h1>
      <p className="muted">{t('waivers.intro')}</p>

      {(me.isLoading || status.isLoading) && <p>{t('waivers.loading')}</p>}
      {(me.isError || status.isError) && <p className="form-error">{t('waivers.error')}</p>}

      {status.data && status.data.length === 0 && <p className="muted">{t('waivers.none')}</p>}
      {status.data && status.data.length > 0 && pending.length === 0 && (
        <output className="muted">{t('waivers.allSigned')}</output>
      )}

      {pending.length > 0 && (
        <section aria-label={t('waivers.actionNeeded')}>
          <h2>{t('waivers.actionNeeded')}</h2>
          {pending.map((w) => (
            <WaiverSignForm key={w.template.id} waiver={w} memberId={memberId as string} />
          ))}
        </section>
      )}

      {signed.length > 0 && (
        <section aria-label={t('waivers.signedSection')}>
          <h2>{t('waivers.signedSection')}</h2>
          <ul className="history">
            {signed.map((w) => (
              <li key={w.template.id}>
                <strong>{w.template.title}</strong>{' '}
                <span className="muted">
                  {t('waivers.version', { version: w.template.version })}
                </span>
                {w.signature && (
                  <>
                    {' — '}
                    <span className="muted">
                      {t('waivers.signedOn', {
                        date: new Date(w.signature.signedAt).toLocaleDateString(),
                      })}
                    </span>
                  </>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}

/** Render an untrusted waiver body as plain text paragraphs (never as HTML — no XSS surface). */
function WaiverBody({ body }: { body: string }) {
  const paragraphs = body
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  return (
    <div className="waiver-body">
      {paragraphs.map((p, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static, render-only split of immutable text
        <p key={i}>{p}</p>
      ))}
    </div>
  );
}

/** One pending waiver: its text + a digital-acknowledgement form (typed name + agree → sign). */
function WaiverSignForm({ waiver, memberId }: { waiver: MemberWaiverStatus; memberId: string }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const titleId = useId();
  const nameId = useId();
  const [name, setName] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [validationKey, setValidationKey] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      signWaiver({
        templateId: waiver.template.id,
        memberId,
        signedByName: name.trim(),
        isGuardian: false,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['myWaiverStatus', memberId] });
    },
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setValidationKey('waivers.mustName');
      return;
    }
    if (!agreed) {
      setValidationKey('waivers.mustAgree');
      return;
    }
    setValidationKey(null);
    mutation.mutate();
  }

  return (
    <form className="card" aria-labelledby={titleId} onSubmit={onSubmit}>
      <h3 id={titleId}>
        {waiver.template.title}{' '}
        <span className="muted">{t('waivers.version', { version: waiver.template.version })}</span>
      </h3>
      <WaiverBody body={waiver.template.bodyMarkdown} />

      <div className="field">
        <label htmlFor={nameId}>{t('waivers.fullName')}</label>
        <input
          id={nameId}
          type="text"
          autoComplete="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-describedby={`${nameId}-help`}
        />
        <p id={`${nameId}-help`} className="muted">
          {t('waivers.fullNameHelp')}
        </p>
      </div>

      <label className="checkbox">
        <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />{' '}
        {t('waivers.agree')}
      </label>

      {validationKey && <p className="form-error">{t(validationKey)}</p>}
      {mutation.isError && <p className="form-error">{t('waivers.signError')}</p>}

      <button type="submit" disabled={mutation.isPending}>
        {mutation.isPending ? t('waivers.signing') : t('waivers.sign')}
      </button>
    </form>
  );
}
