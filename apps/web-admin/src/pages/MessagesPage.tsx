import {
  BROADCAST_CATEGORIES,
  type BroadcastCategory,
  type BroadcastCreateInput,
  MEMBER_STATUSES,
  type MemberSegment,
  type MemberStatus,
} from '@obikai/domain';
import { useMutation } from '@tanstack/react-query';
import { type FormEvent, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { sendBroadcast } from '../api/messages';

type SegmentKind = MemberSegment['kind'];

/**
 * "Message members" (§4.8) — staff compose a broadcast to a member segment. The segment picker maps
 * to the MemberSegment union (all / status / tag); category drives the consent gate (marketing sends
 * only reach members who granted marketing consent). On send, the delivery summary is shown.
 */
export function MessagesPage() {
  const { t } = useTranslation();
  const ids = {
    kind: useId(),
    status: useId(),
    tag: useId(),
    category: useId(),
    subject: useId(),
    body: useId(),
  };
  const [kind, setKind] = useState<SegmentKind>('all');
  const [status, setStatus] = useState<MemberStatus>('active');
  const [tag, setTag] = useState('');
  const [category, setCategory] = useState<BroadcastCategory>('transactional');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');

  const send = useMutation({ mutationFn: sendBroadcast });

  function buildSegment(): MemberSegment {
    if (kind === 'status') return { kind: 'status', status };
    if (kind === 'tag') return { kind: 'tag', tag: tag.trim() };
    return { kind: 'all' };
  }

  const valid =
    subject.trim() !== '' && body.trim() !== '' && (kind !== 'tag' || tag.trim() !== '');

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid) return;
    const input: BroadcastCreateInput = {
      segment: buildSegment(),
      category,
      channel: 'email',
      subject: subject.trim(),
      body: body.trim(),
    };
    send.mutate(input);
  }

  const result = send.data;

  return (
    <section aria-labelledby="messages-heading">
      <h1 id="messages-heading">{t('messages.title')}</h1>
      <p className="muted">{t('messages.intro')}</p>

      <form className="stacked-form" onSubmit={submit}>
        <div className="field-row">
          <span className="field">
            <label htmlFor={ids.kind}>{t('messages.audience')}</label>
            <select
              id={ids.kind}
              value={kind}
              onChange={(e) => setKind(e.target.value as SegmentKind)}
            >
              <option value="all">{t('messages.audienceAll')}</option>
              <option value="status">{t('messages.audienceStatus')}</option>
              <option value="tag">{t('messages.audienceTag')}</option>
            </select>
          </span>
          {kind === 'status' && (
            <span className="field">
              <label htmlFor={ids.status}>{t('messages.status')}</label>
              <select
                id={ids.status}
                value={status}
                onChange={(e) => setStatus(e.target.value as MemberStatus)}
              >
                {MEMBER_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </span>
          )}
          {kind === 'tag' && (
            <span className="field">
              <label htmlFor={ids.tag}>{t('messages.tag')}</label>
              <input id={ids.tag} value={tag} onChange={(e) => setTag(e.target.value)} />
            </span>
          )}
        </div>

        <span className="field">
          <label htmlFor={ids.category}>{t('messages.category')}</label>
          <select
            id={ids.category}
            value={category}
            onChange={(e) => setCategory(e.target.value as BroadcastCategory)}
            aria-describedby={`${ids.category}-help`}
          >
            {BROADCAST_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {t(`messages.categoryValue.${c}`)}
              </option>
            ))}
          </select>
          <small id={`${ids.category}-help`} className="field-help">
            {t('messages.categoryHelp')}
          </small>
        </span>

        <span className="field">
          <label htmlFor={ids.subject}>{t('messages.subject')}</label>
          <input id={ids.subject} value={subject} onChange={(e) => setSubject(e.target.value)} />
        </span>
        <span className="field">
          <label htmlFor={ids.body}>{t('messages.body')}</label>
          <textarea id={ids.body} rows={6} value={body} onChange={(e) => setBody(e.target.value)} />
        </span>

        <div>
          <button type="submit" disabled={!valid || send.isPending}>
            {t('messages.send')}
          </button>
        </div>
      </form>

      {send.isError && (
        <p role="alert" className="form-error">
          {t('messages.sendError')}
        </p>
      )}
      {result && (
        <output className="status">
          {t('messages.result', {
            sent: result.sent,
            total: result.total,
            skipped: result.skippedNoContact + result.skippedNoConsent,
            failed: result.failed,
          })}
        </output>
      )}
    </section>
  );
}
