import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { useSubject } from '../subject/subject-context';

/**
 * Header control that lets a parent choose whose data the app shows — themselves (if a member) or one
 * of their children. Renders only when there is something to switch between (more than one subject);
 * a plain member with no children never sees it. Labelled `<select>` for keyboard + screen-reader use
 * (WCAG 2.1 AA).
 */
export function SubjectSwitcher() {
  const { t } = useTranslation();
  const { subjects, activeMemberId, setActiveMemberId } = useSubject();
  const selectId = useId();

  if (subjects.length <= 1) return null;

  return (
    <label className="subject-switcher" htmlFor={selectId}>
      <span className="subject-switcher-label">{t('viewer.label')}</span>
      <select
        id={selectId}
        value={activeMemberId ?? ''}
        onChange={(e) => setActiveMemberId(e.target.value)}
      >
        {subjects.map((s) => (
          <option key={s.memberId} value={s.memberId}>
            {s.isSelf ? t('viewer.me') : s.name}
          </option>
        ))}
      </select>
    </label>
  );
}
