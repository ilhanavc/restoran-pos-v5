import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

type HealthStatus = 'checking' | 'connected' | 'disconnected';

export default function App(): JSX.Element {
  const { t } = useTranslation();
  const [status, setStatus] = useState<HealthStatus>('checking');
  const [pgVersion, setPgVersion] = useState<string>('');

  useEffect(() => {
    fetch('/health')
      .then(async (res) => {
        if (!res.ok) throw new Error('non-2xx');
        const data = (await res.json()) as { status: string; pg_version: string };
        if (data.status === 'ok') {
          setPgVersion(data.pg_version);
          setStatus('connected');
        } else {
          setStatus('disconnected');
        }
      })
      .catch(() => {
        setStatus('disconnected');
      });
  }, []);

  const colorMap: Record<HealthStatus, string> = {
    checking: 'text-yellow-600',
    connected: 'text-green-600',
    disconnected: 'text-red-600',
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 p-8">
      <h1 className="mb-6 text-2xl font-bold text-gray-800">{t('app.title')}</h1>
      <p className={`text-lg font-semibold ${colorMap[status]}`}>
        {t(`health.${status}`)}
      </p>
      {pgVersion !== '' && (
        <p className="mt-2 text-sm text-gray-500">{pgVersion}</p>
      )}
    </div>
  );
}
