# Session 91 — Kickoff / Devir

Restoran POS v5 — Session 91. Önce bağlam: **CLAUDE.md** + **docs/context-anchor.md §2** (en üst = Session 90) + **.claude/plans/active-plan.md** + **decisions.md → ADR-033** (satır 11566; BU OTURUMUN ANA İŞİNİN — Faz 2 frontend — DoD'si 11664, K7 UI kararı 11627). Detaylı devir: bu dosya + [[project_session_90_summary]].

## DURUM
main **`a13cd8e`** (S90 kapanış; #315-321 merged). **prod code `b8ea4b1`** (#315-320 web/API deploy'lu; **#321 ADR-033 Faz-1 backend + Migration 044 main'de ama prod'a DEPLOY YOK**). 0 açık PR. Kod için **yeni branch** (branch-first; ör. `feat/payment-void-frontend`).

## Session 90 ne yaptı (özet — detay [[project_session_90_summary]])
7 PR (#315-321) + 2 sektör araştırması + ADR-033:
1. **#315 (API deploy):** adisyon fişi Adisyo-tarzı redesign + parçalı ödeme dökümü (ADR-027 Amd1). Kullanıcı fiziksel smoke ✓.
2. **#316-320 (web deploy):** on-demand "Yazdır" · **ödeme "Kaydet" footgun fix (ADR-014 §13)** · sipariş-ekranı Kaydet layout · **"Çağrılar" son-çağrılar modalı (ADR-016 §11)** · **çağrı "Sipariş Aç"→paket-sipariş**. Kullanıcı hepsini canlı doğruladı.
3. **#321 (MERGE, DEPLOY YOK):** **ADR-033 Ödeme-Düzeltme Faz 1 BACKEND** — architect ADR-033 Accepted (9 karar, admin+cashier). Migration 044 + `voidPayment` atomik tx + endpoint + 13-SUM-filtre + audit. security-reviewer ✅ + db-migration-guard blocker düzeltildi. 11/11 void + 687/687 test.

## ▶ BU OTURUMUN ANA İŞİ — ADR-033 Faz 2 = ödeme-void FRONTEND [KOD]
ADR **Accepted**, backend **HAZIR**. Sıra: **implementer** (UI). **Yeni branch.** **hci-reviewer + turkish-ux-reviewer ZORUNLU** (yıkıcı finansal aksiyon UI'ı). i18n-key gate (yeni UI metni). **Migration YOK** (Faz 1'de yapıldı). Basit-önce ([[feedback_simple_first_ui]]).

### Backend kontratı (Faz 1'de HAZIR — bunu tüket)
- **Endpoint:** `POST /payments/:paymentId/void` — `authorize(['admin','cashier'])`; body `{ reasonCode: PaymentVoidReason }`; response `{ payment, order, reopened }` 200. Web api hook yaz (`useVoidPayment`, `useCancelOrder`/`usePrintBill` paterni).
- **Reason enum (`PaymentVoidReasonSchema`, shared-types/payment.ts):** `wrong_payment_type` · `wrong_amount` · `wrong_table` · `duplicate` · `other`. Dropdown = Türkçe etiketler (turkish-ux; ör. "Yanlış ödeme türü"/"Yanlış tutar"/"Yanlış masa"/"Mükerrer"/"Diğer").
- **Hata kodları (errors.ts + tr.json `error.*` var):** `PAYMENT_NOT_FOUND`(404) · `PAYMENT_ALREADY_VOIDED`(409) · `PAYMENT_VOID_CROSS_DAY`(409, "aynı gün değil") · `PAYMENT_VOID_ORDER_TERMINAL`(409) · `PAYMENT_VOID_TAKEAWAY_UNSUPPORTED`(409) · `TABLE_ALREADY_OCCUPIED`(409, "masa yeniden dolmuş"). getErrorMessage ile toast.
- **`payments.voided_at`** artık `findByOrderId`/GET dönüşünde var (null=aktif) → split-state/adisyon ödeme listesinde voided satır **üstü-çizili** göster.

### UI kararı (ADR-033 K7 — decisions.md:11627, 2 giriş tek-endpoint)
1. **Kapalı adisyon reopen:** `ClosedOrdersPanel` (dashboard — bugünün son kapananları, salt-okunur ŞU AN) satırına aksiyon: **"Ödemeyi Geri Al / Masayı Yeniden Aç"** → onay modalı + sebep-dropdown. (Panelin mevcut alanları: orderId/tableCode/paidAt/paymentTypeMix/total — ödemeleri çekmek için order'ın payment'larını fetch gerekebilir; tek ödemeliyse direkt, çok ödemeliyse ödeme-seç.)
2. **Açık siparişte yanlış split satırı:** `SplitPaymentModal` / `DetailedPaymentModal` ödeme-listesinde (paid groups / split-state) satır-başına **"Geri Al"** → aynı onay+sebep.
- Her ikisi `POST /payments/:paymentId/void`. **Onay ZORUNLU** (yıkıcı). Voided satır üstü-çizili (silinmez). Reopen olursa realtime `orders.statusChanged{paid:false}` zaten emit ediliyor → tahta canlı tazelenir.

### DoD (decisions.md:11664 — frontend maddeleri)
- [ ] `useVoidPayment` mutation (web api) + ClosedOrdersPanel satır aksiyonu + split-state "Geri Al" (K7 iki giriş).
- [ ] Onay modalı + sebep-dropdown (enum → TR etiket) + voided üstü-çizili.
- [ ] Hata kodları → Türkçe toast (özellikle TABLE_ALREADY_OCCUPIED = "önce masayı boşalt/taşı", CROSS_DAY, ALREADY_VOIDED).
- [ ] **hci-reviewer + turkish-ux-reviewer ZORUNLU** + i18n-key-checker (yeni metin, hardcoded yok).
- [ ] UI test (web component test altyapısı yok → Playwright E2E veya kod-doğrulama + kullanıcı canlı smoke).
- [ ] Backend değişikliği YOK (Faz 1 hazır) — yalnızca tüket.

### Verification + DEPLOY
Frontend: typecheck + lint + hci/turkish-ux/i18n gate + CI. **SONRA migration+backend+frontend BİRLİKTE prod deploy** (özellik ilk kez canlı+kullanılabilir):
- **Migration'lı deploy (deploy.md §4):** ÖNCE `pg-backup.sh` (backup-strategy.md; migration geri alınamaz forward-only) → lokal `git push prod main` → sunucuda pull + install + shared-types build → **migration:** `source /root/pos-secrets.env` + `DATABASE_URL=migrator... node-pg-migrate up` (044 uygular) → **web build** → `pm2 restart pos-api`. Doğrulama (§4 curl'ları + `pm2 ls`). **Prod'a onaysız dokunma** + migration'lı = ekstra dikkat.
- **Canlı smoke [USER]:** yanlış ödeme al → kapalı adisyondan "Geri Al" → masa yeniden açılır + ödeme voided; yanlış-masa senaryosu; TABLE_ALREADY_OCCUPIED (masa doluyken).

## Sonra
- **MUTFAK fişi redesign** — S89'dan beri bekleyen ayrı iş. kitchen-receipt.ts; Adisyo mutfak-fişi referansı istenecek. (Not: kitchen'da em-dash crash + control-byte açığı chip `task_df442130`.)
- **Ödeme v5.0 quick-win** (opsiyonel — S90 ödeme-workflow araştırması): **"Eşit Böl (N kişi)"** (SplitPaymentModal toggle, toplam÷kişi, /payments amount-partial reuse) + **denominasyon quick-cash** (₺50/100/200 + üste-yuvarla, DetailedPaymentModal nakit). İkisi de S-efor, mevcut modal/endpoint.
- ⏸ ERTELENDİ: A4 KVKK hukuki · KDS · kasiyer-kiosk cutover · [ultracode 🔶] v5.1 derin bug/güvenlik/yük denetimi.

## PROD / DEPLOY / ORTAM
**PROD:** restoranpos.org CANLI · 67 ürün · 25 masa · 1469 müşteri · 3 kullanıcı · **3 agent CANLI** (mutfak JP80H TCP + kasa KASA-2026 spooler USB + Caller ID dükkan PC) · gece şifreli off-site yedek · **migrations prod head 043** (044 main'de ama prod'a UYGULANMADI). prod code `b8ea4b1`.
**DEPLOY** (deploy.md §4): lokal `GIT_SSH_COMMAND="ssh -i ~/.ssh/restoran_pos_ed25519" git push prod main` → sunucuda pull + `pnpm install` + `shared-types build` (+web değiştiyse `web build`; +migration varsa yedek+migrate; +API değiştiyse `pm2 restart pos-api`). SSH `root@167.233.78.127`. **ADR-033 deploy = migration+API+web = tam deploy + önce yedek.**
**ORTAM:** Windows native PG 17.10 `:5432` (servissiz → `Start-Process pg_ctl -D D:/PostgreSql/data start` + WAL poll), `pos_dev`/`pos_test` @**044** (S90'da uygulandı). **CI tek otorite** — merge öncesi CI POLL (S90'da GitHub runner-infra 4× düştü, rerun'la aşıldı; `ci` job runner bulunca ~1-2dk). Test → `pos_test` (`DATABASE_URL=...pos_test`).

## KURALLAR
ADR önce→kod (ADR-033 Accepted → doğrudan implementer Faz 2); DoD; branch-first; cerrahi (kendi orphan temizle); kapsam kilidi (ADR-033 §K9: cross-day refund/kısmi-void/kart-adjust/takeaway → v5.1); **UI değişikliği → hci-reviewer + turkish-ux + i18n ZORUNLU**; DB→db-migration-guard (Faz 2'de migration YOK); ödeme/PII→security-reviewer (Faz 2 backend değişmiyor ama void UI finansal — gerekirse); merge öncesi CI POLL; prod'a onaysız dokunma (migration'lı deploy = ekstra dikkat + yedek); kapanışta anchor§2+plan+memory+kickoff. **ULTRACODE:** fan-out+adversarial'a değince "🔶 değer" derim, o mesajda "ultracode" eklersin.
