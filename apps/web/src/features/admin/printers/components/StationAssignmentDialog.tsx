import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Info, Lock } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../../../../components/ui/dialog';
import { Button } from '../../../../components/ui/button';
import type { ApiCategory } from '../../menu-categories/api';

/**
 * İstasyon atama paneli — ADR-032 Amendment 2 Dilim B (K3).
 *
 * Adisyo "MUTFAK GRUBU" emsali: yazıcıyı aç → hangi kategorileri bastığını
 * işaretle → tek Kaydet ile N kategori yazılır. Depolama tek kolon
 * (`categories.print_station`); join tablosu YOK.
 *
 * Taban istasyon (FIRIN) semantiği dürüstçe gösterilir: `print_station IS NULL`
 * kategoriler taban panelinde İŞARETLİ + KİLİTLİ görünür ve kaydetmeye HİÇ
 * gönderilmez → "işareti kaldırdım ama yine buradan basıyor" çelişkisi doğmaz.
 * Başka istasyona taşımak için o istasyonun panelinden işaretlenir.
 *
 * `kitchen_print=false` kategoriler ATANAMAZ; salt-okunur bölümde "mutfağa
 * gitmiyor" rozetiyle listelenir (K4 — anahtar Menü Tanımları'nda, Dilim C).
 */

/** ADR-032 Amd1 — taban istasyon: atanmamış (NULL) kategoriler buradan basar. */
const BASE_STATION = 'kitchen';

interface StationAssignmentDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Yazıcının kullanıcıya görünen adı (etiket yoksa cihaz kimliği). */
  printerLabel: string;
  /** Bu panelin yönettiği mutfak istasyonu ('kitchen' | 'grill'). */
  stationKind: string;
  categories: ApiCategory[];
  isSubmitting: boolean;
  onSubmit: (categoryIds: string[]) => Promise<void>;
}

export function StationAssignmentDialog({
  open,
  onOpenChange,
  printerLabel,
  stationKind,
  categories,
  isSubmitting,
  onSubmit,
}: StationAssignmentDialogProps) {
  const { t } = useTranslation();
  const isBaseStation = stationKind === BASE_STATION;

  const kitchenCategories = useMemo(
    () => categories.filter((c) => c.kitchen_print),
    [categories],
  );
  const nonKitchenCategories = useMemo(
    () => categories.filter((c) => !c.kitchen_print),
    [categories],
  );

  /** Taban panelinde kilitli satırlar: atanmamış (NULL) kategoriler. */
  const isLocked = (c: ApiCategory): boolean =>
    isBaseStation && c.print_station === null;

  /** Şu an bu istasyona AÇIKÇA atanmış kategoriler (kilitliler hariç). */
  const currentIds = useMemo(
    () =>
      kitchenCategories
        .filter((c) => c.print_station === stationKind)
        .map((c) => c.id),
    [kitchenCategories, stationKind],
  );

  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Panel her açılışta canlı veriden yeniden kurulur (bayat seçim kalmasın).
  useEffect(() => {
    if (open) setSelected(new Set(currentIds));
  }, [open, currentIds]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const addedCount = [...selected].filter((id) => !currentIds.includes(id)).length;
  const removedCount = currentIds.filter((id) => !selected.has(id)).length;
  const hasChanges = addedCount > 0 || removedCount > 0;

  const stationLabel = t(`admin.printers.stations.${stationKind}`, {
    defaultValue: stationKind,
  });

  return (
    <Dialog open={open} onOpenChange={(v) => !isSubmitting && onOpenChange(v)}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>
            {t('admin.printers.assign.title', {
              printer: printerLabel,
              station: stationLabel,
            })}
          </DialogTitle>
          <DialogDescription>
            {t('admin.printers.assign.description', { station: stationLabel })}
          </DialogDescription>
        </DialogHeader>

        {/* Uçuştaki iş uyarısı — Amd1 K10 geri-alma dersi. */}
        <div
          className="flex items-start gap-2 rounded-md p-3 text-[13px]"
          style={{ background: '#fffbeb', color: '#92400e' }}
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{t('admin.printers.assign.futureOnlyWarning')}</span>
        </div>

        <div className="space-y-1">
          {kitchenCategories.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {t('admin.printers.assign.noCategories')}
            </p>
          )}

          {kitchenCategories.map((c) => {
            const locked = isLocked(c);
            const checked = locked || selected.has(c.id);
            // Başka istasyondaysa "şu an: X" rozeti (bu istasyonda değilse).
            const otherStation =
              c.print_station !== null && c.print_station !== stationKind
                ? c.print_station
                : null;

            return (
              <label
                key={c.id}
                data-testid="printer-category-row"
                className={[
                  'flex min-h-[44px] cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm',
                  locked ? 'cursor-not-allowed opacity-70' : 'hover:bg-accent',
                ].join(' ')}
                title={locked ? t('admin.printers.assign.baseLockedTooltip') : undefined}
              >
                <input
                  type="checkbox"
                  className="h-[18px] w-[18px] shrink-0 accent-orange-600"
                  checked={checked}
                  disabled={locked || isSubmitting}
                  onChange={() => toggle(c.id)}
                />
                <span className="flex-1 truncate font-medium">{c.name}</span>
                {locked && (
                  <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                    <Lock className="h-3 w-3" />
                    {t('admin.printers.assign.baseLockedBadge')}
                  </span>
                )}
                {otherStation !== null && (
                  <span
                    className="rounded-full px-2 py-0.5 text-[11px] font-semibold"
                    style={{ background: '#e0e7ff', color: '#3730a3' }}
                  >
                    {t('admin.printers.assign.currentStationBadge', {
                      station: t(`admin.printers.stations.${otherStation}`, {
                        defaultValue: otherStation,
                      }),
                    })}
                  </span>
                )}
              </label>
            );
          })}
        </div>

        {/* Salt-okunur: mutfağa gitmeyen kategoriler (K4). Atanamaz. */}
        {nonKitchenCategories.length > 0 && (
          <div
            className="rounded-md border border-dashed p-3"
            style={{ borderColor: 'var(--v3-border-subtle)' }}
          >
            <p className="mb-1 flex items-center gap-1.5 text-[12px] font-semibold text-muted-foreground">
              <Info className="h-3.5 w-3.5" />
              {t('admin.printers.assign.notKitchenTitle', {
                count: nonKitchenCategories.length,
              })}
            </p>
            <p className="text-[12px] text-muted-foreground">
              {nonKitchenCategories.map((c) => c.name).join(', ')}
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {t('admin.printers.assign.notKitchenHint')}
            </p>
          </div>
        )}

        <DialogFooter className="flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-between">
          {/* Sayı veren onay özeti — v3 dersi 2. */}
          <p className="text-[12px] text-muted-foreground">
            {hasChanges
              ? t('admin.printers.assign.summary', {
                  added: addedCount,
                  removed: removedCount,
                  station: stationLabel,
                })
              : t('admin.printers.assign.noChanges')}
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              onClick={() => void onSubmit([...selected])}
              disabled={isSubmitting || !hasChanges}
            >
              {t('admin.printers.assign.save')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
