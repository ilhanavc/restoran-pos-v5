import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import type { TableRow } from '@restoran-pos/shared-types';
import { AppShell } from '../../components/layout/AppShell';
import { useTables, useTableRealtimeInvalidate } from './api';
import { TableCard } from './components/TableCard';
import { TableDetailPlaceholder } from './components/TableDetailPlaceholder';
import { useSocketEvent } from '../../lib/socket';

/**
 * Masalar — Sprint 8b ana sayfa (read-only kasiyer view).
 *
 * Akış:
 * - Masa grid (status renk + sade label)
 * - Masaya tıklayınca → adisyon Phase 3'te (placeholder modal)
 * - Üst summary: Boş / Dolu sayaçları (v3 paritesi)
 *
 * Realtime: `tables.statusChanged` event → query invalidate (Sprint 7 ADR-010).
 *
 * Masa CRUD (yeni masa / düzenle / sil) ve bölge yönetimi → "Tanımlamalar"
 * sayfasında olacak (gelecek sprint). Sprint 8b kapsamı: salt görünüm.
 */
export default function TablesListPage() {
  const { t } = useTranslation();

  const tablesQuery = useTables();
  const invalidateTables = useTableRealtimeInvalidate();

  // Realtime — Sprint 7 ADR-010 events
  useSocketEvent('tables.statusChanged', () => {
    invalidateTables();
  });

  const [detailTarget, setDetailTarget] = useState<TableRow | null>(null);

  const summary = useMemo(() => {
    const list = tablesQuery.data ?? [];
    const available = list.filter((tbl) => tbl.status === 'available').length;
    const occupied = list.filter((tbl) => tbl.status === 'occupied').length;
    return { available, occupied, total: list.length };
  }, [tablesQuery.data]);

  const sortedTables = useMemo(() => {
    const list = tablesQuery.data ?? [];
    return [...list].sort((a, b) => a.tableNo - b.tableNo);
  }, [tablesQuery.data]);

  return (
    <AppShell>
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-baseline sm:gap-6">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            {t('tables.title')}
          </h1>
          <div className="flex items-center gap-4 text-sm">
            <span className="inline-flex items-center gap-1.5 font-medium text-emerald-700 tabular-nums">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              {t('tables.summary.available', { count: summary.available })}
            </span>
            <span className="inline-flex items-center gap-1.5 font-medium text-rose-700 tabular-nums">
              <span className="h-2 w-2 rounded-full bg-rose-500" />
              {t('tables.summary.occupied', { count: summary.occupied })}
            </span>
          </div>
        </header>

        {tablesQuery.isPending && (
          <div className="flex min-h-[300px] items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-amber-600" />
          </div>
        )}

        {tablesQuery.isSuccess && sortedTables.length === 0 && (
          <div className="rounded-2xl border border-dashed border-stone-300 bg-white/50 p-12 text-center">
            <p className="text-base font-medium text-foreground">
              {t('tables.empty.noTables')}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Masa eklemek için Tanımlamalar sayfasını kullanın.
            </p>
          </div>
        )}

        {tablesQuery.isSuccess && sortedTables.length > 0 && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {sortedTables.map((table) => (
              <TableCard
                key={table.id}
                table={table}
                onClick={() => setDetailTarget(table)}
              />
            ))}
          </div>
        )}
      </div>

      <TableDetailPlaceholder
        open={detailTarget !== null}
        onOpenChange={(v) => !v && setDetailTarget(null)}
        table={detailTarget}
      />
    </AppShell>
  );
}
