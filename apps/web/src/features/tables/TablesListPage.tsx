import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Loader2 } from 'lucide-react';
import type { TableRow } from '@restoran-pos/shared-types';
import { AppShell } from '../../components/layout/AppShell';
import { Button } from '../../components/ui/button';
import { useAuthStore } from '../../store/auth';
import { useTables, useTableRealtimeInvalidate } from './api';
import { TableCard } from './components/TableCard';
import { TableFormDialog } from './components/TableFormDialog';
import { DeleteTableDialog } from './components/DeleteTableDialog';
import { TableDetailPlaceholder } from './components/TableDetailPlaceholder';
import { useSocketEvent } from '../../lib/socket';

/**
 * Masalar — Sprint 8b ana sayfa.
 *
 * Kasiyer akışı:
 * - Masa grid (status renk + kapasite)
 * - Tıklayınca → adisyon Phase 3'te (placeholder modal)
 *
 * Admin ek akışı:
 * - "+ Yeni Masa" → form dialog
 * - Masa kartı ⋯ menü → Düzenle / Sil
 *
 * Realtime: `tables.statusChanged` event → query invalidate (Sprint 7 ADR-010).
 *
 * Bölge (area) filtresi Sprint 8c'de eklenir — şu an tek liste görünüm
 * (anayasa kapsam kilidi: areas CRUD Sprint 8c kapsamı).
 */
export default function TablesListPage() {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === 'admin';

  const tablesQuery = useTables();
  const invalidateTables = useTableRealtimeInvalidate();

  // Realtime — Sprint 7 ADR-010 events
  useSocketEvent('tables.statusChanged', () => {
    invalidateTables();
  });

  // Dialog state
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<TableRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TableRow | null>(null);
  const [detailTarget, setDetailTarget] = useState<TableRow | null>(null);

  const summary = useMemo(() => {
    const list = tablesQuery.data ?? [];
    const available = list.filter((tbl) => tbl.status === 'available').length;
    const occupied = list.filter((tbl) => tbl.status === 'occupied').length;
    return { available, occupied, total: list.length };
  }, [tablesQuery.data]);

  // Sort by tableNo for stable order
  const sortedTables = useMemo(() => {
    const list = tablesQuery.data ?? [];
    return [...list].sort((a, b) => a.tableNo - b.tableNo);
  }, [tablesQuery.data]);

  return (
    <AppShell>
      <div className="mx-auto max-w-7xl space-y-6">
        {/* Page header */}
        <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-baseline gap-4">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              {t('tables.title')}
            </h1>
            <div className="flex items-center gap-3 text-sm">
              <span className="inline-flex items-center gap-1.5 font-medium text-emerald-700 tabular-nums">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                {t('tables.summary.available', { count: summary.available })}
              </span>
              <span className="inline-flex items-center gap-1.5 font-medium text-rose-700 tabular-nums">
                <span className="h-2 w-2 rounded-full bg-rose-500" />
                {t('tables.summary.occupied', { count: summary.occupied })}
              </span>
            </div>
          </div>
          {isAdmin && (
            <Button
              onClick={() => setCreateOpen(true)}
              className="h-11 gap-2 bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-md shadow-amber-500/25 hover:from-amber-600 hover:to-orange-600"
            >
              <Plus className="h-4 w-4" />
              {t('tables.actions.newTable')}
            </Button>
          )}
        </header>

        {/* Loading state */}
        {tablesQuery.isPending && (
          <div className="flex min-h-[300px] items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-amber-600" />
          </div>
        )}

        {/* Empty state */}
        {tablesQuery.isSuccess && sortedTables.length === 0 && (
          <div className="rounded-2xl border border-dashed border-stone-300 bg-white/50 p-12 text-center">
            <p className="text-base font-medium text-foreground">
              {t('tables.empty.noTables')}
            </p>
            {isAdmin && (
              <>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t('tables.empty.noTablesAdmin')}
                </p>
                <Button
                  onClick={() => setCreateOpen(true)}
                  className="mt-4 h-11 gap-2 bg-gradient-to-r from-amber-500 to-orange-500 text-white"
                >
                  <Plus className="h-4 w-4" />
                  {t('tables.actions.newTable')}
                </Button>
              </>
            )}
          </div>
        )}

        {/* Tables grid */}
        {tablesQuery.isSuccess && sortedTables.length > 0 && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {sortedTables.map((table) => (
              <TableCard
                key={table.id}
                table={table}
                isAdmin={isAdmin}
                onClick={() => setDetailTarget(table)}
                onEdit={() => setEditTarget(table)}
                onDelete={() => setDeleteTarget(table)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Dialogs */}
      <TableFormDialog open={createOpen} onOpenChange={setCreateOpen} />
      <TableFormDialog
        open={editTarget !== null}
        onOpenChange={(v) => !v && setEditTarget(null)}
        table={editTarget}
      />
      <DeleteTableDialog
        open={deleteTarget !== null}
        onOpenChange={(v) => !v && setDeleteTarget(null)}
        table={deleteTarget}
      />
      <TableDetailPlaceholder
        open={detailTarget !== null}
        onOpenChange={(v) => !v && setDetailTarget(null)}
        table={detailTarget}
      />
    </AppShell>
  );
}
