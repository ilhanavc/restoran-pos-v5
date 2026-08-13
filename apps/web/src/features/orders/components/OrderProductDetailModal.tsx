import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Loader2, Minus, Plus } from 'lucide-react';
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
import type { ApiProduct, ApiProductVariant } from '../../admin/menu-products/api';
import type {
  ApiAttributeOption,
  ApiEffectiveAttributeGroup,
} from '../api';
import { useEffectiveAttributeGroupsForProduct } from '../api';
import type {
  CartAttributeSelection,
  CartItemEditPayload,
  CartVariantSelection,
} from '../useOrderCart';

/**
 * OrderProductDetailModal — v3 OrderProductDetailModal.jsx birebir paritesi
 * (ADR-013 §10 Karar 10.2 + 10.3).
 *
 * Body sırası (v3):
 *   1. Adet (label sol, [-] [qty input] [+] sağ — yatay row)
 *   2. Porsiyon (info satır: "Porsiyon: **Tam** — ₺xxx") — v5'te porsiyon UI
 *      v5.1 backlog; tek porsiyon görsel bilgi olarak gösterilir
 *   3. Ürün notu (label + textarea, placeholder "İsteğe bağlı…")
 *   4. Özellikler (varsa) — ayraç + grup başlıkları + kart-buton flex grid wrap
 *
 * Footer (v3):
 *   - Sol: "Birim: **₺xxx,xx**" (+ekstra varsa "(+₺yy,yy ekstra)")
 *   - Sağ: İptal | Kaydet (mor)
 *
 * Boş özellik durumunda Özellikler bölümü hiç render edilmez (v3 davranışı).
 */

interface OrderProductDetailModalProps {
  product: ApiProduct | null;
  initial?: {
    selectedAttributes: CartAttributeSelection[];
    variant: CartVariantSelection | null;
    note: string | null;
    quantity: number;
    unitPriceOverrideCents: number | null;
  } | null;
  onClose: () => void;
  onConfirm: (payload: CartItemEditPayload) => void;
}

/** ItemDetailModal ile aynı biçim: "12,50" — kullanıcı alanı geçici boşaltabilsin. */
function formatPriceText(cents: number): string {
  return (cents / 100).toFixed(2).replace('.', ',');
}

export function OrderProductDetailModal({
  product,
  initial = null,
  onClose,
  onConfirm,
}: OrderProductDetailModalProps) {
  const { t } = useTranslation();
  const isEdit = initial !== null;

  const groupsQuery = useEffectiveAttributeGroupsForProduct(product?.id ?? null);
  const groups = groupsQuery.data ?? [];

  const [selections, setSelections] = useState<Record<string, Set<string>>>({});
  const [errors, setErrors] = useState<Record<string, boolean>>({});
  const [note, setNote] = useState<string>('');
  const [quantity, setQuantity] = useState<number>(1);
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(
    null,
  );
  // ADR-013 Amendment 5 K8/K9 — birim fiyat metni; boş bırakılabilir olsun
  // diye string (ItemDetailModal'daki aynı desen). Porsiyon/özellik değişince
  // hesaplanan değere SIFIRLANIR (K9); populate-effect sonrası ilk reset
  // tetiklenmesin diye skip-guard kullanılır.
  const [priceText, setPriceText] = useState<string>('');
  const skipNextPriceResetRef = useRef(false);
  // 🐛 Canlı bug fix (2026-08-02, Masa 8) — populate-effect eskiden
  // `groups`/`variants`'ı da bağımlılık listesinde tutuyordu. Modal AÇIKKEN
  // `groupsQuery` yeniden veri getirip aynı içerikle YENİ bir array referansı
  // üretirse — ki gerçek tetikleyici `OrderScreenPage`'in dinlediği
  // `products.changed`/`categories.changed` socket olaylarıdır (ADR-010 §11.6
  // Amendment 3: BAŞKA bir terminalde menü/özellik fiyatı değişince TÜM
  // terminallerde `['products']` invalidate edilir; window-focus refetch
  // App.tsx'te globalce KAPALI, o değil) — populate YENİDEN tetikleniyordu:
  // kullanıcının o ana kadar yaptığı özellik seçimi sessizce varsayılanlara
  // dönüyor VE hemen ardından kullanıcı yeniden seçince bu seçimin
  // tetiklediği fiyat-sıfırlaması skip-guard tarafından yutuluyordu (₺430
  // yerine ₺380 kaydedildi — Duble
  // Kaşar ücreti kayboldu). `attrsSeededRef` populate'i modal GERÇEKTEN yeni
  // bir ürün/kalem için açıldığında (product/isEdit/initial değişince) bir
  // kez çalıştırır; `groups` yalnız asenkron ilk yüklemeyi beklemek için ayrı
  // bir effect'te, yine tek seferlik okunur.
  const attrsSeededRef = useRef(false);

  const variants = product?.variants ?? [];
  const showPortionPicker = variants.length >= 1;

  // Effect 1 — kimlik: yalnız modal GERÇEKTEN yeni bir ürün/kalem için
  // açıldığında çalışır (`groups`/`variants` referans değişimi TEK BAŞINA
  // tetiklemez — yukarıdaki bug notu).
  useEffect(() => {
    if (product === null) return;
    attrsSeededRef.current = false;
    const basePriceNow = product.priceCents;
    if (isEdit && initial !== null) {
      const init: Record<string, Set<string>> = {};
      for (const a of initial.selectedAttributes) {
        if (init[a.groupId] === undefined) init[a.groupId] = new Set();
        init[a.groupId]!.add(a.optionId);
      }
      setSelections(init);
      setNote(initial.note ?? '');
      setQuantity(initial.quantity);
      setSelectedVariantId(initial.variant?.variantId ?? null);
      // ADR-013 Amendment 5 K8 — override varsa o, yoksa mevcut seçimin
      // hesaplanan fiyatı (`initial`den doğrudan — `selections`/`totalExtraCents`
      // state'i bu effect içinde henüz güncellenmemiş, timing riski önlenir).
      const initComputed =
        basePriceNow +
        (initial.variant?.priceDeltaCents ?? 0) +
        initial.selectedAttributes.reduce((s, a) => s + a.extraPriceCents, 0);
      setPriceText(
        formatPriceText(initial.unitPriceOverrideCents ?? initComputed),
      );
      // Edit modunda seçimler `initial`den geldi, `groups` verisine ihtiyaç
      // yok — Effect 2'nin bunu bir daha ele alması gerekmez.
      attrsSeededRef.current = true;
    } else {
      setNote('');
      setQuantity(1);
      // Default variant: is_default veya ilk
      const defaultV =
        variants.find((v) => v.isDefault) ?? variants[0] ?? null;
      setSelectedVariantId(defaultV?.id ?? null);
      setPriceText(formatPriceText(basePriceNow + (defaultV?.priceDeltaCents ?? 0)));
      // Özellik varsayılanları Effect 2'de (gruplar yüklenince) doldurulur;
      // burada boş başlatmak yeterli.
      setSelections({});
    }
    setErrors({});
    // K9 skip-guard — bu effect'in kendi setSelectedVariantId/setSelections
    // çağrıları aşağıdaki reset-effect'i tetikler; o ilk tetiklenme yok sayılır
    // (kullanıcı henüz hiçbir şey değiştirmedi, populate'i override etmemeli).
    skipNextPriceResetRef.current = true;
    // `variants` bilinçli olarak bağımlılık listesinde değil: `product`dan
    // türer, kendi başına referans değişimiyle (aynı ürün, yeniden fetch)
    // yeniden tetiklenmemeli — bkz. yukarıdaki canlı bug notu.
  }, [product, isEdit, initial]);

  // Effect 2 — yalnız create modunda: gruplar asenkron yüklenince (veya zaten
  // cache'de hazırsa aynı commit'te) varsayılan seçili option'ları BİR KEZ
  // doldurur. `attrsSeededRef` sayesinde sonraki `groups` referans
  // değişimleri (arka plan refetch) burayı tekrar çalıştırmaz.
  useEffect(() => {
    if (product === null || isEdit) return;
    if (attrsSeededRef.current) return;
    if (groupsQuery.isPending) return;
    attrsSeededRef.current = true;
    const init: Record<string, Set<string>> = {};
    for (const g of groups) {
      const set = new Set<string>();
      for (const opt of g.options) {
        if (opt.is_default) {
          if (g.selection_type === 'single') {
            if (set.size === 0) set.add(opt.id);
          } else {
            set.add(opt.id);
          }
        }
      }
      init[g.id] = set;
    }
    setSelections(init);
  }, [product, isEdit, groups, groupsQuery.isPending]);

  const toggleOption = (
    group: ApiEffectiveAttributeGroup,
    optionId: string,
  ) => {
    setSelections((prev) => {
      const cur = new Set(prev[group.id] ?? []);
      if (group.selection_type === 'single') {
        if (cur.has(optionId)) {
          cur.clear();
        } else {
          cur.clear();
          cur.add(optionId);
        }
      } else {
        if (cur.has(optionId)) cur.delete(optionId);
        else cur.add(optionId);
      }
      return { ...prev, [group.id]: cur };
    });
    setErrors((prev) => {
      if (!prev[group.id]) return prev;
      const next = { ...prev };
      delete next[group.id];
      return next;
    });
  };

  const totalExtraCents = useMemo(() => {
    let sum = 0;
    for (const g of groups) {
      const sel = selections[g.id];
      if (sel === undefined) continue;
      for (const opt of g.options) {
        if (sel.has(opt.id)) sum += opt.extra_price_cents;
      }
    }
    return sum;
  }, [groups, selections]);

  const basePrice = product?.priceCents ?? 0;
  const selectedVariant: ApiProductVariant | null =
    variants.find((v) => v.id === selectedVariantId) ?? null;
  const variantDelta = selectedVariant?.priceDeltaCents ?? 0;
  const unitPriceCents = basePrice + variantDelta + totalExtraCents;

  // ADR-013 Amendment 5 K9 — porsiyon/özellik DEĞİŞİNCE override sıfırlanır
  // (hesaplanan değere döner). Populate-effect'in (yukarıda) tetiklediği ilk
  // çalışma skip-guard ile yok sayılır — kullanıcı henüz hiçbir şey
  // değiştirmedi, o effect'in kendi populate'i override edilmemeli.
  useEffect(() => {
    if (skipNextPriceResetRef.current) {
      skipNextPriceResetRef.current = false;
      return;
    }
    setPriceText(formatPriceText(basePrice + variantDelta + totalExtraCents));
  }, [selectedVariantId, totalExtraCents]);

  const parsedPriceCents = Math.round(
    Number(priceText.replace(/\./g, '').replace(',', '.')) * 100,
  );
  const priceValid = Number.isFinite(parsedPriceCents) && parsedPriceCents >= 0;
  // K9 doğal sonucu: kullanıcı fiyatı hiç dokunmadıysa priceText zaten
  // hesaplanan değere eşittir → override GÖNDERİLMEZ (temiz "katalog fiyatı"
  // kaydı; audit yalnız gerçek sapmada tetiklenir, K6).
  const isPriceOverridden = priceValid && parsedPriceCents !== unitPriceCents;

  const handleConfirm = () => {
    if (product === null) return;
    if (!priceValid) return;
    const newErrors: Record<string, boolean> = {};
    for (const g of groups) {
      if (g.is_required && (selections[g.id]?.size ?? 0) === 0) {
        newErrors[g.id] = true;
      }
    }
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    const optById = new Map<string, ApiAttributeOption>();
    for (const g of groups) for (const opt of g.options) optById.set(opt.id, opt);

    const flat: CartAttributeSelection[] = [];
    for (const g of groups) {
      const sel = selections[g.id];
      if (sel === undefined) continue;
      for (const optId of sel) {
        const opt = optById.get(optId);
        if (opt === undefined) continue;
        flat.push({
          groupId: g.id,
          optionId: opt.id,
          groupName: g.name,
          optionName: opt.name,
          extraPriceCents: opt.extra_price_cents,
        });
      }
    }

    const variantSelection: CartVariantSelection | null = selectedVariant
      ? {
          variantId: selectedVariant.id,
          variantName: selectedVariant.name,
          priceDeltaCents: selectedVariant.priceDeltaCents,
        }
      : null;

    onConfirm({
      selectedAttributes: flat,
      variant: variantSelection,
      note: note.trim() === '' ? null : note.trim(),
      quantity,
      unitPriceOverrideCents: isPriceOverridden ? parsedPriceCents : null,
    });
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 12,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    color: 'var(--v3-text-muted)',
  };

  return (
    <Dialog open={product !== null} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-[18px] font-extrabold uppercase tracking-tight">
            {product?.name ?? ''}
          </DialogTitle>
          <DialogDescription className="text-[12px]">
            {t('order.attributes.subtitleDefault')}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] overflow-y-auto pr-1">
          {groupsQuery.isPending && (
            <div className="flex items-center justify-center py-8">
              <Loader2
                className="h-5 w-5 animate-spin"
                style={{ color: 'var(--v3-text-muted)' }}
              />
              <span
                className="ml-2 text-sm"
                style={{ color: 'var(--v3-text-muted)' }}
              >
                {t('order.attributes.loading')}
              </span>
            </div>
          )}

          {groupsQuery.isError && (
            <div
              className="rounded-md border border-dashed p-4 text-center text-sm"
              style={{
                borderColor: 'var(--v3-danger, #dc2626)',
                color: 'var(--v3-danger, #dc2626)',
              }}
            >
              {t('order.attributes.loadFailed')}
            </div>
          )}

          {!groupsQuery.isPending && !groupsQuery.isError && (
            <>
              {/* 1) Adet — ItemDetailModal ile ortak biçim: 48px ± Button +
                  statik sayı (büyük dokunma hedefi, POS HCI). */}
              <div className="flex items-center justify-between py-2">
                <span style={labelStyle}>{t('order.attributes.qtyLabel')}</span>
                <div className="flex items-center gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                    disabled={quantity <= 1}
                    style={{ minHeight: 48, minWidth: 48 }}
                    aria-label={t('order.a11y.decrement')}
                  >
                    <Minus size={18} />
                  </Button>
                  <span className="w-10 text-center text-[20px] font-extrabold tabular-nums">
                    {quantity}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setQuantity((q) => Math.min(99, q + 1))}
                    disabled={quantity >= 99}
                    style={{ minHeight: 48, minWidth: 48 }}
                    aria-label={t('order.a11y.increment')}
                  >
                    <Plus size={18} />
                  </Button>
                </div>
              </div>

              {/* 2) Porsiyon — ADR-013 §11 Karar 11.1.
                  variants.length >= 2: kart-buton picker; ==1: info satır;
                  ==0: hiç render edilmez. */}
              {showPortionPicker && variants.length >= 2 && (
                <div className="mt-4">
                  <span style={{ ...labelStyle, display: 'block', marginBottom: 10 }}>
                    {t('order.attributes.portionLabel')}
                  </span>
                  <div className="flex flex-wrap gap-2.5">
                    {variants.map((v) => {
                      const sel = v.id === selectedVariantId;
                      const effectivePrice = basePrice + v.priceDeltaCents;
                      return (
                        <button
                          key={v.id}
                          type="button"
                          onClick={() => setSelectedVariantId(v.id)}
                          className="rounded-lg border-2 text-center font-bold"
                          style={{
                            padding: '12px 16px',
                            borderColor: sel
                              ? 'var(--v3-purple, #7C5CFA)'
                              : 'var(--v3-border-subtle)',
                            background: sel
                              ? 'var(--v3-purple-bg, #EEEAFE)'
                              : 'var(--v3-surface-1, #fff)',
                            color: sel
                              ? 'var(--v3-purple, #7C5CFA)'
                              : 'var(--v3-text-primary)',
                            minWidth: 120,
                          }}
                        >
                          <div className="text-[14px]">{v.name}</div>
                          <div className="mt-1 text-[13px] opacity-85">
                            {formatMoney(effectivePrice)}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              {showPortionPicker && variants.length === 1 && selectedVariant && (
                <div
                  className="mt-3 text-[13px]"
                  style={{ color: 'var(--v3-text-muted)' }}
                >
                  {t('order.attributes.portionLabel')}:{' '}
                  <strong style={{ color: 'var(--v3-text-primary)' }}>
                    {selectedVariant.name}
                  </strong>{' '}
                  — {formatMoney(basePrice + selectedVariant.priceDeltaCents)}
                </div>
              )}

              {/* 2.5) Birim fiyat — ADR-013 Amendment 5 K8: ItemDetailModal
                  görsel dili birebir (aynı key'ler, aynı hizalama). Kalem
                  HENÜZ sunucuya gitmedi (pending) — Kaydet'e basınca sipariş
                  oluşurken bu fiyatla POST edilir. */}
              <label className="mt-4 flex flex-col gap-1">
                <span style={labelStyle}>{t('order.itemDetail.unitPrice')}</span>
                <input
                  inputMode="decimal"
                  value={priceText}
                  onChange={(e) => setPriceText(e.target.value)}
                  aria-invalid={!priceValid}
                  className="h-12 rounded-lg border px-3 text-[17px] font-bold tabular-nums"
                  style={{
                    borderColor: priceValid
                      ? 'var(--v3-border-subtle)'
                      : 'var(--v3-danger, #dc2626)',
                    borderWidth: priceValid ? 1 : 2,
                  }}
                />
                {/* HCI review bulgusu — geçersiz tutarda Kaydet sessizce disabled
                    olmasın, açık hata gösterilsin (Nielsen #1/#5). */}
                {!priceValid && (
                  <span
                    className="text-[12px] font-semibold"
                    style={{ color: 'var(--v3-danger, #dc2626)' }}
                  >
                    {t('order.itemDetail.priceInvalidError')}
                  </span>
                )}
                <span className="text-[12px]" style={{ color: 'var(--v3-text-muted)' }}>
                  {t('order.itemDetail.priceScopeHint')}
                </span>
                {/* HCI review bulgusu — K9 sıfırlaması sessiz olmasın diye
                    ÖN-BİLGİ olarak proaktif gösterilir (transient toast yerine;
                    modal kapanınca transient UI doğrulanamaz riski — bkz.
                    feedback_transient_ui_live_verification). */}
                <span className="text-[11px]" style={{ color: 'var(--v3-text-muted)' }}>
                  {t('order.itemDetail.priceResetOnChangeHint')}
                </span>
              </label>

              {/* Satır toplamı — anında güncellenir (efektif fiyat × adet). */}
              <div
                className="mt-2 flex items-center justify-between rounded-lg px-3 py-2"
                style={{ background: 'var(--v3-surface-2, #f1f5f9)' }}
              >
                <span className="text-[13px] font-bold">
                  {t('order.itemDetail.lineTotal')}
                </span>
                <strong className="text-[19px] tabular-nums">
                  {priceValid ? formatMoney(parsedPriceCents * quantity) : '—'}
                </strong>
              </div>

              {/* 3) Ürün notu */}
              <div className="mt-4">
                <span style={{ ...labelStyle, display: 'block', marginBottom: 8 }}>
                  {t('order.attributes.noteLabel')}
                </span>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  maxLength={280}
                  placeholder={t('order.attributes.notePlaceholder')}
                  rows={3}
                  className="w-full resize-y rounded-lg border p-2 text-sm focus:outline-none focus:ring-2"
                  style={{
                    borderColor: 'var(--v3-border-subtle)',
                    minHeight: 72,
                  }}
                />
              </div>

              {/* 4) Özellikler — v3: boş ise hiç render edilmez */}
              {groups.length > 0 && (
                <div
                  className="mt-5 pt-4"
                  style={{ borderTop: '1px solid var(--v3-border-subtle)' }}
                >
                  <span
                    style={{
                      ...labelStyle,
                      display: 'block',
                      marginBottom: 14,
                    }}
                  >
                    {t('order.attributes.sectionTitle')}
                  </span>
                  <div className="flex flex-col gap-[18px]">
                    {groups.map((group) => {
                      const sel = selections[group.id] ?? new Set<string>();
                      const isSingle = group.selection_type === 'single';
                      const hasError = errors[group.id] === true;
                      return (
                        <div key={group.id}>
                          <div className="mb-2">
                            <span
                              className="text-[13px] font-bold"
                              style={{
                                borderBottom: `2px solid ${hasError ? 'var(--v3-danger, #dc2626)' : 'var(--v3-purple, #7C5CFA)'}`,
                                paddingBottom: 2,
                                color: hasError
                                  ? 'var(--v3-danger, #dc2626)'
                                  : 'var(--v3-text-primary)',
                              }}
                            >
                              {group.name}
                            </span>
                            <span
                              className="ml-2 text-[11px]"
                              style={{ color: 'var(--v3-text-muted)' }}
                            >
                              (
                              {isSingle
                                ? t('order.attributes.selectionSingle')
                                : t('order.attributes.selectionMultiple')}
                              {group.is_required
                                ? ` · ${t('order.attributes.requiredTag')}`
                                : ''}
                              )
                            </span>
                            {hasError && (
                              <div
                                className="mt-1 text-[11px]"
                                style={{ color: 'var(--v3-danger, #dc2626)' }}
                              >
                                {t('order.attributes.requiredError')}
                              </div>
                            )}
                          </div>

                          <div className="flex flex-wrap gap-2">
                            {group.options.map((opt) => {
                              const selected = sel.has(opt.id);
                              return (
                                <button
                                  key={opt.id}
                                  type="button"
                                  onClick={() => toggleOption(group, opt.id)}
                                  className="relative flex items-center gap-1.5 rounded-lg border-2 text-left"
                                  style={{
                                    padding: '9px 14px',
                                    borderColor: selected
                                      ? 'var(--v3-purple, #7C5CFA)'
                                      : 'var(--v3-border-subtle)',
                                    background: selected
                                      ? 'var(--v3-purple-bg, #EEEAFE)'
                                      : '#fff',
                                  }}
                                >
                                  {selected && (
                                    <span
                                      className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full"
                                      style={{
                                        background: 'var(--v3-purple, #7C5CFA)',
                                      }}
                                    >
                                      <Check size={10} color="#fff" />
                                    </span>
                                  )}
                                  <div>
                                    <div className="text-[13px] font-semibold">
                                      {opt.name}
                                    </div>
                                    <div
                                      className="mt-0.5 text-[11px] font-medium"
                                      style={{
                                        color:
                                          opt.extra_price_cents === 0
                                            ? 'var(--v3-purple, #7C5CFA)'
                                            : 'var(--v3-text-secondary, #475569)',
                                      }}
                                    >
                                      {opt.extra_price_cents === 0
                                        ? t('order.attributes.free')
                                        : t('order.attributes.extraPrice', {
                                            amount: formatMoney(
                                              opt.extra_price_cents,
                                            ),
                                          })}
                                    </div>
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <DialogFooter className="border-t pt-3">
          <div className="flex w-full items-center justify-between">
            {/* Sol: fiyat elle değiştirildiyse kısa gösterge (K12 kardeşi —
                asıl gösterge sepet satırında/AdisyonPanel'de). */}
            <div className="text-[13px]">
              {isPriceOverridden && (
                <span style={{ color: 'var(--v3-purple, #7C5CFA)', fontWeight: 700 }}>
                  {t('order.itemDetail.priceOverriddenHint')}
                </span>
              )}
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={onClose}>
                {t('order.attributes.cancel')}
              </Button>
              <Button
                type="button"
                onClick={handleConfirm}
                disabled={!priceValid}
                style={{
                  background: 'var(--v3-purple, #7C5CFA)',
                  color: '#fff',
                }}
              >
                {t('order.attributes.save')}
              </Button>
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
