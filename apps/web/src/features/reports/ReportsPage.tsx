import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BarChart3, Construction } from 'lucide-react';
import { AppShell } from '../../components/layout/AppShell';
import { PageHeader } from '../../components/layout/PageHeader';
import RangeFilter, {
  type RangeValue,
} from '../../components/reports/RangeFilter';

/**
 * `/raporlar` page — Sprint 14 PR-5a skeleton.
 *
 * Backend ready (13 endpoints, ADR-015 + ADR-021); UI is skeleton only:
 *   - Title + subtitle
 *   - RangeFilter (preset switch; custom range comes in PR-5b)
 *   - Under-construction empty-state placeholder
 *
 * KPI tiles, charts, tables and CSV download belong to PR-5b/5c/5d/5e.
 * Guarded by ProtectedRoute `requiredRoles={['admin', 'cashier']}` in router.tsx.
 */
export default function ReportsPage() {
  const { t } = useTranslation();
  const [range, setRange] = useState<RangeValue>({ preset: 'today' });

  return (
    <AppShell>
      <PageHeader
        title={t('reports.title')}
        subtitle={t('reports.subtitle')}
        icon={BarChart3}
      />

      <div className="flex-1 space-y-6 overflow-auto p-6">
        <RangeFilter value={range} onChange={setRange} />

        <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-12 text-center">
          <Construction
            className="mx-auto h-12 w-12 text-slate-400"
            aria-hidden="true"
          />
          <h2 className="mt-4 text-lg font-medium text-slate-900">
            {t('reports.underConstruction.title')}
          </h2>
          <p className="mt-2 text-sm text-slate-600">
            {t('reports.underConstruction.body')}
          </p>
        </div>
      </div>
    </AppShell>
  );
}
