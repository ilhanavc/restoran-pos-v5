# Session 92 — Kickoff / Devir

Restoran POS v5 — Session 92. Önce bağlam: **CLAUDE.md** + **docs/context-anchor.md §2** (en üst = Session 91) + **.claude/plans/active-plan.md**. Detaylı devir: bu dosya + [[project_session_91_summary]].

## DURUM
main **`27926ca`** = **prod code `27926ca`** (S91: #323-325 + 2 deploy). **Migrations prod head 044.** 0 açık PR. Kod için yeni branch (branch-first).

## Session 91 ne yaptı (özet — detay [[project_session_91_summary]])
1. **🎯🎯 ADR-033 ödeme-void UÇTAN UCA KAPANDI** (#323 frontend + Migration 044 prod deploy + kullanıcı canlı smoke ✓): VoidPaymentDialog (zorunlu sebep enum + tek-aktif otomatik seçim + voided üstü-çizili) + ClosedOrdersPanel "Geri Al" + SplitPaymentModal "Ödemeyi Geri Al" + VoidedPaymentCard. hci BLOCKER (TABLE_ALREADY_OCCUPIED genel metni) void'e-özel metinle düzeltildi.
2. **Migrator sahiplik dersi (#324, runbook §6 as-built):** fresh-install tabloları postgres-owned bırakmıştı; ilk migrator-run migration (044) `aclcheck_error` ile düştü → 27 tablo+seq `OWNER TO migrator` + REVOKE yeniden + kontroller `f` ✓. Gelecek migration'larda sorun YOK artık.
3. **🎯 Mutfak fişi redesign CANLI** (#325 ADR-004 Amd5 Accepted+implemented+deploy+kağıt smoke ✓✓): Layout A masa kompakt / Layout B paket kurye fişi (müşteri+adres+Ödeme:planned_payment_type+fiyatlar+TUTAR). 3 canlı bug öldü: em-dash garson-placeholder çökmesi (chip task_df442130) · mutfak RAW-ISO + kasa UTC-slice yanlış saat (`formatReceiptDateTime` tenant-tz) · kontrol-baytı enjeksiyonu (`sanitizeForCP857`). KVKK: `purgePrintJobs` 30g retention (paket fişi payload'ı PII taşır) + envanter §5.

## ▶ BU OTURUMUN İŞ ADAYLARI (kullanıcıya sor — kod tarafında zorunlu iş YOK)

### A) Cutover günü planlaması [USER karar + OPS] — pilot kritik yolu
Restoran hâlâ Adisyo'yla; v5 her parçası tek tek canlı doğrulandı (mutfak+kasa fişi, mobil, Caller ID, ödeme+void, raporlar, yedek). Kalan = **cutover günü** (ADR-031 K6, gün sonunda; active-plan B-listesi):
1. Kullanıcıyla TARİH seç (sakin gün; Adisyo aboneliği açık kalır — K10 rollback).
2. Test verisi temizliği kararı + `order_no` 1'den (prod'da test order'lar var — S91 void-smoke'ları dahil; sayımı tazele).
3. Kasiyer istasyonu (kiosk) kurulumu [OPS].
4. Kasa fişi Adisyo round-trip smoke (S89'da kanıtlı, cutover günü tekrar).
5. P5-5 go-live smoke + go/no-go ölçümleri (p95 script hazır) → 2-4 hafta → Adisyo iptali = **pilot bitiş**.

### B) Ödeme v5.0 quick-win [KOD, opsiyonel — S90 araştırma önerisi]
- **Eşit Böl (N kişi):** SplitPaymentModal'a toggle; toplam÷kişi; `/payments` amount-partial reuse.
- **Denominasyon quick-cash:** DetailedPaymentModal nakit alanına ₺50/100/200 + üste-yuvarla butonları.
İkisi de S-efor, migration yok. Gate: hci + turkish-ux + i18n (UI).

### C) Chip'ler (tek tık, ayrı oturum)
- `task_20f0e0c9` SplitPaymentModal ön-mevcut hardcoded-string temizliği (payment.split.* key'lerin çoğu tr.json'da VAR, komponent bağlamıyor).
- `task_4455260a` Kaydet-ödeme E2E.

### Beklemede [USER]
A4 KVKK avukat onayı+tesis+yayın (paket execute-hazır; 🚩 Hetzner Türk-SCC düğümü).

## PROD / DEPLOY / ORTAM
**PROD:** restoranpos.org CANLI · prod code `27926ca` · migrations head **044** · 67 ürün · 25 masa · 1469 müşteri · 3 kullanıcı · 3 agent (mutfak JP80H TCP + kasa KASA-2026 spooler + Caller ID) · gece şifreli off-site yedek · **yeni:** ödeme-void UI + iki-yerleşim mutfak fişi + print_jobs 30g retention (cron 03:30).
**DEPLOY** (deploy.md §4): lokal `GIT_SSH_COMMAND="ssh -i ~/.ssh/restoran_pos_ed25519" git push prod main` → sunucuda pull + `pnpm install --frozen-lockfile --filter ...` + `shared-types build` ŞART (+web değiştiyse web build; +migration varsa ÖNCE pg-backup + migrator ile up — **sahiplik artık migrator'da, §6**) + `pm2 restart pos-api`. SSH `root@167.233.78.127`.
**ORTAM:** Windows native PG 17.10 (servissiz → `Start-Process pg_ctl -D D:/PostgreSql/data start` + poll), `pos_dev`/`pos_test` @044. Test → `DATABASE_URL=...pos_test`. **CI tek otorite** — merge öncesi POLL. Dev: API `pnpm --filter @restoran-pos/api dev` (:3001) · web `preview_start` veya `pnpm --filter @restoran-pos/web dev` (:5173) · login admin@local.test/admin1234.

## KURALLAR
ADR önce→kod; DoD; branch-first; cerrahi; kapsam kilidi (quick-win'ler S90 araştırmasıyla meşru — yine de scope-guard'dan geçir); UI → hci+turkish-ux+i18n ZORUNLU; ödeme/PII → security-reviewer; DB → db-migration-guard; merge öncesi CI POLL; **prod'a onaysız dokunma** (deploy kararını kullanıcıya sor — S91'de iki kez AskUserQuestion ile soruldu, patern bu); kapanışta anchor §2+plan+memory+kickoff. **ULTRACODE:** fan-out+adversarial'a değince "🔶 değer" derim, o mesajda "ultracode" eklersin.
