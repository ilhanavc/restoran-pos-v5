import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Minus, Plus, Trash2, Gift } from 'lucide-react';
import { formatMoney } from '@restoran-pos/shared-domain';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../../../components/ui/dialog';
import { Button } from '../../../components/ui/button';
import type { ApiOrderItem } from '../api';
import type { ApiProductVariant } from '../../admin/menu-products/api';

/**
 * Kaydedilmiş kalem detay modalı — ADR-013 Amendment 3.
 *
 * Adisyon panelindeki KAYITLI bir satıra tıklanınca açılır. Kapsam (Amd3 K1):
 * adet · **porsiyon** · birim fiyat · ürün notu · ürünü sil · ikram et.
 *
 * Amd3 K6 — YAZICI DAVRANIŞI KULLANICIYA SÖYLENİR:
 *   adet/fiyat/not → fiş BASILMAZ (sessiz kayıt)
 *   sil            → mutfağa iptal fişi BASILIR
 * Kullanıcı beklenmedik kâğıtla karşılaşmasın diye silme butonunun altında
 * açıkça yazar.
 *
 * Amd3 K3 — fiyat/adet/not yetkisi HERKESTE; **ikram admin/kasiyerde kaldı**
 * (§9.2 değişmedi) → `canComp` false ise buton RENDER EDİLMEZ (ADR-026 K6
 * "yetkisiz aksiyon hiç gösterilmez"; aksi hâlde basılır ve 403 alınır).
 */
interface ItemDetailModalProps {
  /** null = kapalı. */
  item: ApiOrderItem | null;
  onOpenChange: (open: boolean) => void;
  /** admin/cashier ise true — ikram butonunu görünür kılar. */
  canComp: boolean;
  /** Kalemin ÜRÜNÜNE ait porsiyonlar; boşsa porsiyon bloğu render edilmez. */
  variants: ApiProductVariant[];
  isSaving: boolean;
  onSave: (patch: {
    quantity?: number;
    unitPriceCents?: number;
    note?: string | null;
    variantId?: string | null;
  }) => void;
  onVoid: () => void;
  onToggleComp: () => void;
}

export function ItemDetailModal({
  item,
  onOpenChange,
  canComp,
  variants,
  isSaving,
  onSave,
  onVoid,
  onToggleComp,
}: ItemDetailModalProps) {
  const { t } = useTranslation();
  const [qty, setQty] = useState(1);
  // Fiyat metin olarak tutulur: kullanıcı "12,50" yazabilsin ve alanı
  // geçici olarak boşaltabilsin (sayıya zorlamak imleci zıplatıyordu).
  const [priceText, setPriceText] = useState('');
  const [note, setNote] = useState('');
  const [variantId, setVariantId] = useState<string | null>(null);

  // Modal her açılışta kalemin GÜNCEL değerlerinden doldurulur.
  useEffect(() => {
    if (item === null) return;
    setQty(item.quantity);
    setPriceText((item.unit_price_cents / 100).toFixed(2).replace('.', ','));
    setNote(item.note ?? '');
    setVariantId(item.variant_id_snapshot ?? null);
  }, [item]);

  if (item === null) return null;

  const parsedPrice = Math.round(
    Number(priceText.replace(/\./g, '').replace(',', '.')) * 100,
  );
  const priceValid = Number.isFinite(parsedPrice) && parsedPrice >= 0;
  const lineTotal = priceValid ? parsedPrice * qty : 0;

  const dirty =
    qty !== item.quantity ||
    (priceValid && parsedPrice !== item.unit_price_cents) ||
    note !== (item.note ?? '') ||
    variantId !== (item.variant_id_snapshot ?? null);

  const handleSave = () => {
    onSave({
      ...(qty !== item.quantity && { quantity: qty }),
      ...(priceValid &&
        parsedPrice !== item.unit_price_cents && { unitPriceCents: parsedPrice }),
      ...(note !== (item.note ?? '') && { note: note === '' ? null : note }),
      ...(variantId !== (item.variant_id_snapshot ?? null) && { variantId }),
    });
  };

  return (
    <Dialog open={item !== null} onOpenChange={(v) => !isSaving && onOpenChange(v)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{item.product_name}</DialogTitle>
          <DialogDescription>{t('order.itemDetail.subtitle')}</DialogDescription>
        </DialogHeader>

        {/* Adet — büyük dokunma hedefleri (POS HCI) */}
        <div className="flex items-center justify-between gap-3">
          <span className="text-[13px] font-bold">{t('order.itemDetail.qty')}</span>
          <div className="flex items-center gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => setQty((q) => Math.max(1, q - 1))}
              disabled={isSaving || qty <= 1}
              style={{ minHeight: 48, minWidth: 48 }}
            >
              <Minus size={18} />
            </Button>
            <span className="w-10 text-center text-[20px] font-extrabold tabular-nums">
              {qty}
            </span>
            <Button
              type="button"
              variant="outline"
              onClick={() => setQty((q) => Math.min(99, q + 1))}
              disabled={isSaving || qty >= 99}
              style={{ minHeight: 48, minWidth: 48 }}
            >
              <Plus size={18} />
            </Button>
          </div>
        </div>

        {/* Porsiyon — ürünün varyantı varsa. Seçim birim fiyatı sunucuda
            yeniden kurar (eski delta düş, yeni delta ekle); kullanıcı fiyatı
            ELLE de değiştirdiyse o kazanır (Amd3 K2). */}
        {variants.length > 0 && (
          <div className="flex flex-col gap-1">
            <span className="text-[13px] font-bold">
              {t('order.itemDetail.portion')}
            </span>
            <div className="flex flex-wrap gap-2">
              {variants.map((v) => {
                const selected = variantId === v.id;
                return (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => setVariantId(selected ? null : v.id)}
                    disabled={isSaving}
                    aria-pressed={selected}
                    className="rounded-lg border-2 px-3 text-[14px] font-bold transition-colors"
                    style={{
                      minHeight: 44,
                      borderColor: selected
                        ? 'var(--v3-purple, #7C5CFA)'
                        : 'var(--v3-border-subtle)',
                      background: selected
                        ? 'var(--v3-purple-bg, #EEEAFE)'
                        : '#fff',
                      color: selected ? 'var(--v3-purple, #7C5CFA)' : 'inherit',
                    }}
                  >
                    {v.name}
                    {v.priceDeltaCents !== 0 && (
                      <span className="ml-1.5 text-[12px] font-semibold">
                        {v.priceDeltaCents > 0 ? '+' : ''}
                        {formatMoney(v.priceDeltaCents)}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Birim fiyat — Amd3 K2: yalnız BU satıra yazılır */}
        <label className="mt-1 flex flex-col gap-1">
          <span className="text-[13px] font-bold">
            {t('order.itemDetail.unitPrice')}
          </span>
          <input
            inputMode="decimal"
            value={priceText}
            onChange={(e) => setPriceText(e.target.value)}
            disabled={isSaving}
            className="rounded-lg border px-3 text-[17px] font-bold tabular-nums"
            style={{ minHeight: 48, borderColor: 'var(--v3-border-subtle)' }}
          />
          <span className="text-[12px]" style={{ color: 'var(--v3-text-muted)' }}>
            {t('order.itemDetail.priceScopeHint')}
          </span>
        </label>

        {/* Satır toplamı — değişiklik anında görünür */}
        <div
          className="flex items-center justify-between rounded-lg px-3 py-2"
          style={{ background: 'var(--v3-surface-2, #f1f5f9)' }}
        >
          <span className="text-[13px] font-bold">
            {t('order.itemDetail.lineTotal')}
          </span>
          <strong className="text-[19px] tabular-nums">
            {priceValid ? formatMoney(lineTotal) : '—'}
          </strong>
        </div>

        {/* Ürün notu */}
        <label className="flex flex-col gap-1">
          <span className="text-[13px] font-bold">{t('order.itemDetail.note')}</span>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, 280))}
            disabled={isSaving}
            rows={2}
            className="rounded-lg border px-3 py-2 text-[15px]"
            style={{ borderColor: 'var(--v3-border-subtle)' }}
          />
        </label>

        {/* Yıkıcı / ikram aksiyonları */}
        <div className="mt-1 grid grid-cols-2 gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={onVoid}
            disabled={isSaving}
            style={{ minHeight: 48, color: 'var(--v3-danger, #dc2626)' }}
          >
            <Trash2 size={16} className="mr-1.5" />
            {t('order.itemDetail.delete')}
          </Button>
          {canComp && (
            <Button
              type="button"
              variant="outline"
              onClick={onToggleComp}
              disabled={isSaving}
              style={{ minHeight: 48 }}
            >
              <Gift size={16} className="mr-1.5" />
              {item.is_comped
                ? t('order.itemDetail.uncomp')
                : t('order.itemDetail.comp')}
            </Button>
          )}
        </div>
        {/* K6 — silmenin fiş bastıracağı ÖNCEDEN söylenir. */}
        <p className="text-[12px]" style={{ color: 'var(--v3-text-muted)' }}>
          {t('order.itemDetail.deletePrintsHint')}
        </p>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSaving}
          >
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            onClick={handleSave}
            disabled={isSaving || !dirty || !priceValid}
          >
            {isSaving ? t('order.itemDetail.saving') : t('order.itemDetail.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
