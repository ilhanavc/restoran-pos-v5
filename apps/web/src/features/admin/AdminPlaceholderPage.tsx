import { useTranslation } from 'react-i18next';
import { Wrench } from 'lucide-react';
import { AppShell } from '../../components/layout/AppShell';

interface AdminPlaceholderPageProps {
  /** Sayfa başlığı i18n key (örn. 'admin.menuDefinitions.title'). */
  titleKey: string;
}

/**
 * Tanımlamalar alt sayfaları için ortak placeholder.
 *
 * V3 paritesi page-header iskeleti (Tables/Dashboard pattern):
 * - mt-3 (12px) + min-h-42 + mb-[14px]
 * - sol pl-[74px] (toggle gap)
 *
 * İleri PR'larda her bir sayfa kendi tam içeriğiyle değiştirilir.
 */
export function AdminPlaceholderPage({ titleKey }: AdminPlaceholderPageProps) {
  const { t } = useTranslation();

  return (
    <AppShell>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4 pl-[74px] pr-6 mt-3 mb-[14px] min-h-[42px]">
        <h1
          className="text-[22px] font-extrabold tracking-tight leading-[1.15]"
          style={{ color: 'var(--v3-text-primary)' }}
        >
          {t(titleKey)}
        </h1>
      </div>
      <div className="flex flex-1 min-h-0 items-center justify-center pb-6">
        <div className="flex max-w-md flex-col items-center gap-3 text-center">
          <Wrench
            className="h-10 w-10"
            strokeWidth={1.5}
            style={{ color: 'var(--v3-text-muted)' }}
          />
          <p
            className="text-base font-medium"
            style={{ color: 'var(--v3-text-primary)' }}
          >
            {t('admin.placeholder.title')}
          </p>
          <p
            className="text-sm leading-relaxed"
            style={{ color: 'var(--v3-text-muted)' }}
          >
            {t('admin.placeholder.body')}
          </p>
        </div>
      </div>
    </AppShell>
  );
}
