import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { UNASSIGNED_AREA, formatMoney } from '@restoran-pos/shared-domain';
import {
  tableDisplayNumber,
  compareTablesForDisplay,
} from '../utils/tableLabel';
import type { ApiTable } from '../api';
import type { Area } from '@restoran-pos/shared-types';

/**
 * TargetTablePicker — hedef-masa seçici ızgarası.
 *
 * MergeTableModal'ın (ADR-029 Karar H) picker adımından ÇIKARILDI; ADR-035 S13
 * "hedef seçici MergeTableModal görünümü" kararı bu bileşenle karşılanır
 * (ürün taşıma akışı kendi picker'ını yazmaz, bunu kullanır).
 *
 * Saf sunum: hangi masaların aday olduğuna ÇAĞIRAN karar verir (`candidates`);
 * bileşen yalnız gruplar + sıralar + basar. Kural (iki akışta da aynı):
 * bölgeye göre gruplu, grup içi masa numarasına göre sıralı, bölgesiz orphan
 * grup EN SONDA, aday yoksa `emptyText` boş-durumu.
 *
 * Tutar rozeti (`active_order_total_cents`) yalnız DOLU masada basılır — merge
 * akışındaki davranışın aynısı. `emptyBadge` verilirse BOŞ masada onun yerine
 * o etiket görünür (ADR-035 S3: boş hedefte yeni adisyon açılacağını kullanıcı
 * seçmeden önce görür). Merge akışı bu prop'u geçmez → görünümü değişmez.
 */
export interface TargetTablePickerProps {
  /** Aday masalar — kaynak masa ve akışa uymayanlar ÇAĞIRAN tarafından elenmiş olmalı. */
  candidates: ApiTable[];
  areas: Area[];
  /** Hiç aday yoksa gösterilecek metin (i18n'den gelir). */
  emptyText: string;
  /** Boş masada tutar yerine basılacak rozet (i18n). Verilmezse ikinci satır yok. */
  emptyBadge?: string;
  onSelect: (table: ApiTable) => void;
}

export function TargetTablePicker({
  candidates,
  areas,
  emptyText,
  emptyBadge,
  onSelect,
}: TargetTablePickerProps) {
  const { t } = useTranslation();

  // Bölgeye göre gruplu; bölgesiz orphan grup en sonda.
  const groups = useMemo(() => {
    const byArea: { areaId: string | null; name: string; tables: ApiTable[] }[] =
      [];
    // S105: grup içi sıra masa numarasına göre (sunucu sırası karışık geliyordu).
    for (const area of areas) {
      const tables = candidates
        .filter((tbl) => tbl.area_id === area.id)
        .sort(compareTablesForDisplay);
      if (tables.length > 0) {
        byArea.push({ areaId: area.id, name: area.name, tables });
      }
    }
    // Bölgesiz orphan grup EN SONA.
    const orphans = candidates
      .filter((tbl) => tbl.area_id === null)
      .sort(compareTablesForDisplay);
    if (orphans.length > 0) {
      byArea.push({
        areaId: UNASSIGNED_AREA,
        name: t('tables.group.unassigned'),
        tables: orphans,
      });
    }
    return byArea;
  }, [candidates, areas, t]);

  const labelFor = (tbl: ApiTable): string => {
    const n = tableDisplayNumber(tbl);
    return n !== null ? t('tables.tableLabel', { number: n }) : tbl.code;
  };

  if (groups.length === 0) {
    return (
      <div
        className="rounded-xl border border-dashed p-8 text-center text-sm"
        style={{
          borderColor: 'var(--v3-border-subtle)',
          color: 'var(--v3-text-muted)',
        }}
      >
        {emptyText}
      </div>
    );
  }

  return (
    <div className="max-h-[60vh] space-y-4 overflow-y-auto">
      {groups.map((group) => (
        <div key={group.areaId ?? UNASSIGNED_AREA}>
          <p
            className="mb-2 text-[12px] font-semibold uppercase tracking-wide"
            style={{ color: 'var(--v3-text-muted)' }}
          >
            {group.name}
          </p>
          <div className="grid grid-cols-3 gap-2">
            {group.tables.map((tbl) => (
              <button
                key={tbl.id}
                type="button"
                onClick={() => onSelect(tbl)}
                className="flex h-16 flex-col items-center justify-center gap-0.5 rounded-xl border text-[14px] font-semibold transition-colors hover:[background:var(--v3-surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/40"
                style={{
                  borderColor: 'var(--v3-border-subtle)',
                  background: '#fff',
                  color: 'var(--v3-text-primary)',
                }}
              >
                <span>{labelFor(tbl)}</span>
                {tbl.active_order_total_cents !== null ? (
                  <span
                    className="text-[11px] font-semibold tabular-nums"
                    style={{ color: 'var(--v3-text-muted)' }}
                  >
                    {formatMoney(tbl.active_order_total_cents)}
                  </span>
                ) : (
                  emptyBadge !== undefined && (
                    <span
                      className="text-[11px] font-semibold"
                      style={{ color: 'var(--v3-text-muted)' }}
                    >
                      {emptyBadge}
                    </span>
                  )
                )}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
