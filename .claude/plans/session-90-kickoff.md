# Session 90 — Kickoff / Devir

Restoran POS v5 — Session 90. Önce bağlam: **CLAUDE.md** + **docs/context-anchor.md §2** (en üst = Session 89) + **.claude/plans/active-plan.md** + **decisions.md → ADR-027 Amendment 1** (satır 10635; BU OTURUMUN ANA İŞİNİN tam DoD'si 10695) + gerekirse ADR-014 (ödeme K7) / ADR-004 §7 (pure render). Detaylı devir: bu dosya + [[project_session_89_summary]].

## DURUM
main **`ed1dfdb`** (S88 kapanış #313) + **S89 kapanış commit** (kasa-agent-canlı docs + **ADR-027 Amd1** + anchor/plan/kickoff — main'e merge edildi), **prod code `ad14c5a`** (S89'da prod-kod merge/deploy YOK). **Kod YAZILMADI.** Kod için **yeni branch aç** (branch-first; ör. `feat/adisyon-fisi-impl`) — ADR-027 Amd1 main'de HAZIR. 0 açık PR.

## Session 89 ne yaptı (özet — detay [[project_session_89_summary]])
1. **🎯🎯 KASA SPOOLER AGENT CANLI kuruldu** (restoran PC DESKTOP-12RF81K, RustDesk; Zadig'siz; **kasa+mutfak fişi fiziksel BASIYOR**, register OK `agentId=acfa506c`). Cutover'ın en riskli parçası bitti. 3 canlı engel aşıldı → [[feedback_print_agent_new_transport_cutover_deploy]] (eski-exe deploy / API_URL nssm-env / Türkçe-encoding / config-BOM).
2. **ADİSYON FİŞİ yeniden tasarım işi başladı** — Adisyo 3 fiş referans + 2 web araştırma + kod keşfi → **ADR-027 Amendment 1 Accepted** (kullanıcı onaylı). **Kod yazılmadı** (kullanıcı "günü kapat" dedi).

## ▶ BU OTURUMUN ANA İŞİ — ADR-027 Amd1 adisyon fişi implementasyonu [KOD]
ADR **Accepted**, tam DoD hazır (`decisions.md:10695`). Sıra: **implementer** (ADR var). **Yeni branch** (branch-first; ADR main'de). **YENİ MIGRATION YOK** (tüm veri mevcut kolonlarda). **security-reviewer ZORUNLU** (ödeme finansal + item.note serbest-metin PII fişe basılır). **i18n gate YOK** (ESC/POS server-render sabit Türkçe). **hci** = gerçek POS-80 kağıt smoke.

### Kontrat (ADR-027 Amd1 B — kod-doğrulanmış)
`BillReceiptParams` genişler (`bill-receipt.ts` içinde, shared-types'a TAŞINMAZ):
- `order_type: 'dine_in' | 'takeaway'` → "Sipariş Kanalı" (dine_in="Masa Siparişi", takeaway="Paket / Gel-Al")
- `server_name: string | null` → "Garson: X" (null → "—")
- `items[].note: string | null` + `items[].modifiers: string[]`
- `payments: Array<{ type: 'cash'|'card'|'transfer'; amountCents: number }>`
- `paidTotalCents` + `remainingCents`

### Hedef tasarım (48 kolon, ESC/POS metin)
```
================================================   (= majör)
                  DİLAN PİDE            (ortalı, çift-boyut dblH+dblW)
              08.07.2026  20:35         (ortalı, normal)
================================================
Adisyon No: 482
Garson: İlhan               Salon - Masa 11   (twoCol)
Sipariş Kanalı: Masa Siparişi
------------------------------------------------   (- minör)
Kaşarlı Sucuklu             1        350,00   (3-kolon: ad·adet·tutar sağa)
Vejeteryan Pide             1        340,00
  [kaşarlı]                                   (modifiye alt-satır)
  (az pişmiş)                                 (not alt-satır, varsa)
================================================
TUTAR                          790,00 TL      (doubleHeight+bold — NOT aşağıda)
------------------------------------------------  ← yalnız payments.length>1
Tahsil Edilen                4.120,00 TL           döküm bloğu:
--------------- Ödemeler ------------------------
Kredi Kartı                        710,00
Nakit                              840,00
Kalan                              0,00 TL
================================================
                 AFİYET OLSUN          (ortalı, çift-boyut)
              Teşekkür ederiz!         (ortalı, normal)
[4 satır feed + CUT_FULL]
```
- **Koşullu döküm:** `payments.length > 1` → Tahsil Edilen / ----Ödemeler---- / her ödeme (tür+tutar) / Kalan. `≤ 1` → yalın (TUTAR'dan sonra direkt footer).
- **TUTAR NOT (implement kararı):** `doubleHeight+bold` kullan — `doubleWidth` twoCol hizalamayı 24-kolona bozar (her karakter 2× genişlik). Başlık + AFİYET OLSUN ortalı tek-satır olduğu için tam çift-boyut (dblH+dblW) sorunsuz. Fiziksel smoke'ta kullanıcı isterse TUTAR'ı da tam-çift yaparız (twoCol'u 24'e göre).
- Para: kalem tutarı "350,00" (TL yok, sütun); TUTAR/Tahsil/Kalan "790,00 TL". `₺` YOK (CP857'de yok → v5.1 grafik). Ayraç `=`×48 majör / `-`×48 minör. Sade (adres/KDV/bilgi-fişi YOK). Fiş no = `order_no`. Birim = adet.

### Veri akışı (ADR-027 Amd1 D — enqueue-bill-job TEK-FETCH otoritesi)
`enqueue-bill-job.ts` (`apps/api/src/print/`) orderId'den kendi çeker; iki çağıran (`orders.ts:698` Adisyon Yazdır + `payments.ts:214` pay-and-print) `{orderId, tenantId, actorUserId}`'a sadeleşir (item-map + detail-fetch KALDIR):
- **payments:** `createPaymentsRepository(db).findByOrderId(tenantId, orderId)` → `PaymentRow[]` (`payment_type` + `amount_cents`). `paidTotal = Σ amount_cents`; `remaining = order.total_cents − paidTotal`.
- **modifiers:** `order_item_attributes` (`option_name_snapshot`; Migration 017, `resolveItemAttributes.ts` yazar) → **YENİ read-join** (`findOrderById` bunu fetch ETMİYOR).
- **garson:** `users` join @ `orders.waiter_user_id` (paterni `enqueue-kitchen-job.ts:80-92` kopyala — username→server_name).
- **order_type / item.note:** zaten `orders` / `order_items` kolonları (findOrderById dönüşü veya küçük select).
- **Render pattern DEĞİŞMEZ:** `renderBillReceipt(params, ESC_POS.CODEPAGE_CP857_PAGE61)` (kasa codepage 61, ADR-004 Amd3); pure (IO/clock/random yok).

### Kod paternleri hazır (S89'da okundu)
- `esc-pos.ts`: `printMode({bold,doubleHeight,doubleWidth})` (bit 0x08/0x10/0x20) · `align('left'|'center'|'right')` · `feed(n)` (ESC d n) · `CUT_FULL` · `FEED_LINE` · `concat`.
- `bill-receipt.ts` mevcut: `WIDTH=40` (→48), `twoCol(left,right)`, `money()` (formatMoney → digits+" TL"), `line()`. **Tam yeniden yazılacak.**
- payment enum: `packages/shared-types/src/payment.ts` (`cash`/`card`/`transfer`). Türkçe map: cash→Nakit, card→Kredi Kartı, transfer→Havale/EFT.

### DoD (decisions.md:10695 — birebir izle)
bill-receipt.ts (params+render 48-kolon+döküm) · enqueue-bill-job.ts (tek-fetch) · orders.ts:698 + payments.ts:214 (identifier'a sadeleş, pay-and-print fire-and-forget korunur) · bill-receipt.test.ts (48-kolon/çift-boyut/3-kolon/modifiye-not/döküm>1/yalın≤1/CP857 Türkçe snapshot) · migration-yok doğrula · **security-reviewer** · i18n-YOK · hci kağıt smoke · **mutfak fişi HARİÇ**.

### Verification
`DATABASE_URL="postgresql://postgres:postgres@localhost:5432/pos_test" pnpm --filter @restoran-pos/api test` (bill-receipt render + entegrasyon) + typecheck + lint. CI POLL. **Gerçek POS-80 kağıt smoke:** kasa agent CANLI → web'den Adisyon Yazdır + parçalı-ödeme kapanış → fiziksel fiş → 48 kolon dolu mu / çift-boyut iri mi / ödeme dökümü doğru mu / Türkçe (ç/ğ/ş/ı) doğru mu / kesim tam mı → kullanıcı foto ile teyit (Adisyo ile yan yana).

## Sonra
- **MUTFAK fişi yeniden tasarımı** — ayrı iş (kullanıcı S89'da "sonraki adım" dedi). kitchen-receipt.ts, Adisyo mutfak fişi referansı istenecek.
- **Cutover kalanı** ([USER]/[OPS]): kasiyer istasyonu (kiosk) + test verisi temizliği + `order_no` 1'den (Adisyo bırakma günü). ⏸ ERTELENDİ: A4 KVKK hukuki · KDS (kağıt fiş) · P5-6 CONCURRENTLY gate · [D pilot sonrası ultracode 🔶] v5.1 derin bug/güvenlik/yük denetimi.

## PROD / DEPLOY / ORTAM
**PROD:** 67 ürün · 25 masa · 1469 müşteri · 3 kullanıcı · **3 agent CANLI** (mutfak JP80H TCP 192.168.1.120 + **kasa KASA-2026 spooler USB001** + Caller ID dükkan PC) · gece şifreli off-site yedek · migrations 043. prod code `ad14c5a`.
**DEPLOY** (deploy.md §4): lokal `GIT_SSH_COMMAND="ssh -i ~/.ssh/restoran_pos_ed25519" git push prod main` → sunucuda pull + `pnpm install` + `shared-types build` (+API değiştiyse `pm2 restart pos-api`). SSH `root@167.233.78.127`. **Prod'a onaysız dokunma.** Fiş işi = **API deploy** gerektirir (bill render server-side) → fiş merge sonra prod deploy + kasa agent zaten canlı basar.
**RESTORAN PC (DESKTOP-12RF81K):** kasa+mutfak+caller agent kurulu; kasa queue `KASA-2026` (POS-80 USB001). Yeni print-agent özelliği canlıya alırken [[feedback_print_agent_new_transport_cutover_deploy]] (kurulu exe eski kalır!). Uzak = RustDesk file-transfer + ASCII script.
**ORTAM:** Windows native PG 17.10 `:5432` (servissiz → `pg_ctl -D D:/PostgreSql/data -w start`), `pos_dev`/`pos_test` @043. **CI tek otorite** — merge öncesi CI POLL.

## KURALLAR
ADR önce→kod (ADR-027 Amd1 zaten Accepted → doğrudan implementer); DoD; branch-first (branch var); cerrahi (kendi orphan temizle); kapsam kilidi (₺/grafik/logo/düzenlenebilir-header = v5.1; mutfak fişi ayrı iş); DB→db-migration-guard (bu işte migration YOK); **auth/payment/PII→security-reviewer ZORUNLU**; UI-metni i18n → fiş ESC/POS sabit-TR (gate YOK, ADR'de gerekçeli); merge öncesi CI POLL; prod'a onaysız dokunma; kapanışta anchor§2+plan+memory+kickoff. **ULTRACODE:** fan-out+adversarial'a değince "🔶 değer" derim, o mesajda "ultracode" eklersin.
