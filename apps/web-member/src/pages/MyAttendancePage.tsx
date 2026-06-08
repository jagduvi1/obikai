import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getMe, myAttendance } from '../api/member-data';

/** "My attendance": the member's own check-in history (self-access GET /attendance?memberId=own). */
export function MyAttendancePage() {
  const { t, i18n } = useTranslation();
  const me = useQuery({ queryKey: ['me'], queryFn: getMe });
  const memberId = me.data?.memberId ?? null;
  const attendance = useQuery({
    queryKey: ['myAttendance', memberId],
    queryFn: () => myAttendance(memberId as string),
    enabled: !!memberId,
  });

  return (
    <section aria-labelledby="att-heading">
      <h1 id="att-heading">{t('attendance.title')}</h1>
      {(me.isLoading || attendance.isLoading) && <p>{t('attendance.loading')}</p>}
      {(me.isError || attendance.isError) && (
        <p role="alert" className="form-error">
          {t('attendance.error')}
        </p>
      )}
      {attendance.data && attendance.data.length === 0 && (
        <p className="muted">{t('attendance.empty')}</p>
      )}
      {attendance.data && attendance.data.length > 0 && (
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">{t('attendance.when')}</th>
              <th scope="col">{t('attendance.method')}</th>
            </tr>
          </thead>
          <tbody>
            {attendance.data.map((a) => (
              <tr key={a.id}>
                <td>{new Date(a.occurredAt).toLocaleString(i18n.language)}</td>
                <td>{t(`attendance.methodValue.${a.method}`)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
