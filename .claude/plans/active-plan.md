# Aktif Plan — Phase 5: Pilot Go-Live + Adisyo→v5 Geçişi + v3 Müşteri Taşıma

> Bu dosya o an üzerinde çalıştığımız sprint'in tek kaynağıdır. Phase/sprint değişince **tamamen yenilenir**.
> Tüm faz roadmap'i: `docs/project-charter.md` → "Faz Roadmap". Geçmiş detay: git history + memory `project_session_*_summary.md`.
> Bu fazın tam kararları: `.claude/memory/decisions.md` → **ADR-031** (14 karar + sprint + DoD).

**Son güncelleme:** 2026-07-08 (Session 87 kapanış — #307 Caller ID artıkları + #308 codepage fix + 🎯 kasa yazıcısı **SPOOLER ile Zadig'siz canlı doğrulandı** (codepage 61 empirik) + **ADR-004 Amd4 spooler transport Accepted #309** [impl sonraki oturum]. Önceki (S86 kapanış) — **Caller Bridge readiness #291 (dotnet 12/12 + X-Tenant-Id kontrat doğrulandı + route-mount `/api` + bayat skill) + A4 KVKK paketi execute-hazır #292 ([ALANLAR] dolu + m.9/VERBİS güncel teyit; 🚩 Hetzner Türk-SCC engeli = avukat düğümü) + A2 ✅ (2 admin+1 garson, kara liste 0) + 🎯 A6 pilot çekirdek smoke ✅ (mobil→mutfak fişi + web kasiyer + mobil↔web senkron)**; KULLANICI KARARLARI: **KDS yok/kağıt fiş yeter** + **A4 hukuki pilotta ertelendi**; **oturum finali: 🎯 CALLER ID UÇTAN UCA CANLI** — dükkan PC kurulum + canlı tam denetim 4 prod bug (#300-303, kök neden `callerStationLookup` bootstrap wiring) + #304 regresyon + istasyon=İlhan)
**main HEAD:** `8aa01d6` (S87 toplam 3 PR #307-309; S86 sonu `ddd0e76` = 16 PR #291-306) · **prod code == `ad14c5a`** (S87'de deploy YOK — docs/agent-side/test; health ✓)
**▶ SIRADAKİ: [KOD sonraki oturum] ADR-004 Amd4 implementasyonu** (spooler transport — config dalı + `spooler-transport.ts` + vendored **C# NativeAOT** winspool exe + MSI E2E + Amd3 ESC t 61 label kaldır; tam DoD `decisions.md` ADR-004 Amd4) → **cutover'ı Zadig'siz kılar** (kasa printing spooler RAW; codepage 61 S87'de FİZİKSEL doğrulandı). Sonra **cutover günü** ([USER]/[OPS]: kasiyer kiosk + test verisi temizliği + order_no 1'den + go-live smoke + go/no-go p95<200ms; runbook `docs/ops/cutover-gunu-runbook.md`) · 2-4 hafta → Adisyo iptali = pilot bitiş. ✅ A1/A2/A3/A5 Caller ID/A6/A7 + **kasa yazıcı fiziksel teyit (S87)**. ⏸ ERTELENDİ: A4 hukuki + KDS + P5-6 gate + [D ultracode 🔶] v5.1 denetim. Detay: `.claude/plans/session-88-kickoff.md`.**

## Durum: Phase 0-4 ✅ · Phase 5 🔄 **P5-1 ✅ · P5-2 ✅** (menü 67 + müşteri 1469 + masa 25/25; A2 personel [USER] üstlendi; A4 KVKK taslak 🟡 avukatta) · **🎯 P5-3 BACKUP TAM ✅** (Storage Box BX11 `u628233` + 6 ayak + restore drill birebir; **go/no-go #4 KAPANDI**) · **P5-4 mobil ✅ + mutfak ✅ + PR-7c ✅ + 🎯 CALLER ID ✅ CANLI (S86)** (kalan: kasa agent + kasiyer istasyonu cutover'da) · P5-5 ⏳ (A6 p95 + A7 fallback prep ✅) · P5-6 ⏸

**Gerçeklik değişimi (ADR-031):** Restoran ŞU ANDA **Adisyo** kullanıyor, v3 kullanım dışı. Charter'ın "2 hafta paralel (v3 ana/v5 yedek)" varsayımı GEÇERSİZ → geçiş **Adisyo→v5 doğrudan go-live**. Kod yazılmadı; her KOD işi aşağıda PR olarak planlı, taze oturumlara bırakıldı.

| Faz | Durum |
|---|---|
| Phase 0-2 | ✅ |
| Phase 3 Sipariş+Mutfak+Ödeme+Yazıcı+Rapor | ✅ (Session 70, tag `v0.3.0`) |
| Phase 4 Mobil + Caller ID + Audit + Yedek | ✅ (mobil operasyonel terminal + masa-yönetimi ailesi ADR-027/028/029; Faz B kalanı = ADR-030 rezerv v5.1) |
| **Phase 5 Pilot + Migration** | 🔄 **P5-1 ✅** (restoranpos.org CANLI) · P5-2 kısmen · P5-3..6 bekliyor |

## Pilot bitiş yol haritası (Session 84 denetimi — BU SIRAYLA)

> Dayanak: S84 denetimi — prod canlı sayım: `products=1 · tables=25 ✅ · areas=1 · users=2 · customers=1469 · agents=2 · queued=0`.
> Kritik yol: **menü girişi → backup ön-koşulu → cutover günü → 2-4 hafta → Adisyo iptali = pilot bitiş.**

### A — Cutover hazırlığı (A1-A2 sıralı; A3/A4 paralel yürür)
| # | İş | Sahip | Not |
|---|---|---|---|
| A1 | ~~**Menü girişi**~~ ✅ **CANLI GİRİLDİ (S84)** — 67 ürün / 9 kategori (55'i Adisyo fotolarından SQL ile prod'a + 12 çorba/dürüm kullanıcı; test KIYMALI PİDE soft-delete) | [USER]→✅ | 🟢 KRİTİK YOL AÇILDI — fiş smoke + eğitim artık yapılabilir. Bölge: areas=1 (ayrım isteniyorsa ekle) |
| A2 | ~~Personel kullanıcıları (kasiyer/garson/mutfak) + kara liste~~ → **[USER] ÜSTLENDİ (S85)** — Claude tarafı KAPALI: mekanizma haritalandı+doğrulandı (web `/users` CRUD; **login=email**, username=görünen ad; kara liste 409 atama-engeli çalışıyor), rehber verildi | [USER] ✅ (S86) | **S86 ✅ gerçek kullanıcılar girildi** (prod salt-okunur teyit: 2 admin + 1 garson); kara liste boş (0), ihtiyaç oldukça elle |
| A3 | **Storage Box BX11 al** → backup 6 ayağı: rclone config + age-keygen (**key KASAYA+offline, sunucudan SİL**) + backup.env (`PGDATABASE=pos_prod`, PGHOST boş) + systemd timer + ilk gerçek yedek + SUNUCU restore drill + retention doğrula → §9 yeşil | [USER alım+kasa] + [OPS Claude] | Go/no-go ÖN-KOŞULU (ADR-031 K7); kod hazır (#284) |
| A4 | KVKK m.9 dayanak + aydınlatma metni | [USER/hukuki] | **S86: paket execute-hazır** ([ALANLAR] dolu: İlhan Avcı/Dilan Pide + m.9/VERBİS güncel teyit). 🚩 Almanya yeterlilik YOK + Hetzner Türk-SCC imzalamayabilir → avukat düğümü (fallback taahhütname+izin). VERBİS muaf. Kalan = avukat onayı+tesis+yayın. `aydinlatma-metni-taslak.md` |
| A5 | ~~KDS ekranı~~ + kasiyer istasyonu (kiosk) + Caller Bridge | [OPS] | **S86: KDS DÜŞTÜ** (kağıt fiş yeter) + **🎯 CALLER ID CANLI** — dükkan PC servis + 4 prod fix (#300-303) + istasyon=İlhan + **canlı popup doğrulandı**. Kalan yalnız kasiyer istasyonu (cutover'da) |
| A6 | Ön-smoke (Adisyo'ya DOKUNMADAN): mobil sipariş→mutfak fişi Türkçe + web kasiyer + realtime; p95 script | [OPS] | **S86 ✅ kullanıcı canlı doğruladı:** mobil→mutfak fişi Türkçe + web kasiyer + mobil↔web senkron. p95 script hazır (cutover'da koşulur). Kasa fişi HARİÇ (Adisyo'da) |
| A7 | Personel eğitimi + kağıt-fallback 1-sayfa şablonu | [USER; şablonu Claude taslaklar] | |

### B — Cutover günü (gün sonunda, ADR-031 K6)
1. Test verisi temizliği kararı + `order_no` 1'den (prod'da 8 test order + 1 test ürün) — [OPS, kullanıcı onayı]
2. **Zadig → WinUSB** (kasa yazıcısı Adisyo'dan v5'e geçer — Adisyo'nun basmasını durduran adım; geri-alma reçetesi memory `project_kasa_printer_adisyo_shared`)
3. `install-second-agent.ps1 -ApiUrl -ApiKey -JobKinds bill` + USB VID/PID config + servis
4. Kasa fiş smoke: **codepage 61 ampirik teyit** (yanlışsa `codepage-scan.ps1` → `CODEPAGE_CP857_PAGE61` tek satır fix + deploy)
5. Tam go-live smoke (P5-5 listesi) + go/no-go ölçümleri başlar
6. Rollback hazır: >30dk sipariş alınamıyor / veri şüphesi → Adisyo'ya dön (K10; abonelik açık)

### C — Stabilizasyon (2-4 hafta) → PİLOT BİTİŞ
- Günlük pm2 + haftalık `rclone lsl` + p95 izleme + aylık restore drill
- Kriterler (charter :125/:129-136) sağlanınca → **Adisyo iptali** (açık soru #6 tarih) → charter :124/:194-201 + forward-ref doc güncellemeleri (P5-5 DOCS) → **PİLOT KAPANIŞ**

### D — Pilot sonrası: v5.1 derin denetim programı (Fable 5 + ultracode 🔶)
Pilot kapanınca AYRI kickoff (kendi planı/ADR'si) ile: (1) derinlemesine kod analizi + **bug denetimi** (multi-agent adversarial, tüm kod tabanı), (2) **güvenlik denetimi/testi + güçlendirme** (RLS, alerting, rate-limit gözden geçirme — v5.1 backlog buradan beslenir), (3) **ağır yük testi** (ADR-031 bilinçli v5.1'e ertelemişti — tam sırası). Hepsi ultracode-worthy; kapsam kilidi gereği pilotta BAŞLANMAZ.

## Phase 5 sprint listesi (ADR-031)

Etiket: **[KOD]**=PR/implementer · **[DOCS]**=doküman · **[USER]**=kullanıcı aksiyonu · **[OPS]**=sunucu/kurulum
Kural: her [KOD] işi kendi PR'ı + DoD + (dokunduğu alana göre) hci/security/db-migration-guard gate; merge öncesi CI poll.

### P5-1 — Altyapı envanteri + provisioning + env/secret ✅ **KAPANDI (Session 81, 2026-07-04)**
- [USER] ✅ Hetzner hesabı mevcuttu (proje `restoran-pos` açıldı); domain **restoranpos.org** Namecheap'ten alındı (~$8.68/yıl; A `@`+`www` → `167.233.78.127`)
- [OPS] ✅ **CX23** provision (CX22 satıştan kalkmış — aynı kademe; ~$7.09/ay) + firewall (yalnız 22/80/443; PG localhost-only) + fail2ban; **Storage Box P5-3'e** (backup ayağıyla birlikte alınacak)
- [OPS] ✅ PG 17.10 + Node 22 + PM2 `pos-api` (tek instance, systemd kalıcı) + Nginx path-based (`/api` strip + `/socket.io` upgrade) + Let's Encrypt (auto-renew)
- [DOCS] ✅ `docs/ops/deploy.md` (#259) — as-built, komutlar canlı sunucuda test edilerek doğrulandı; ADR-001 §7.1 checklist taşındı (prod'da `f` ✓) + §7.2 manuel-rotasyon amendment'ı in-place
- **DoD ✅:** TLS yeşil · `https://restoranpos.org/api/health` 200 · socket.io handshake sid ✓ · migrations sıfır DB'ye koştu head `043` (41/41)
- Deploy modeli: lokal `git push prod` (bare repo) — GitHub deploy key bilinçli eklenmedi (erişim-yetkisi değişikliği kullanıcıya bırakıldı)

### P5-2 — Prod bootstrap + KVKK inventory + veri taşıma 🔄 **BÜYÜK ÖLÇÜDE ✅ (müşteri taşıma CANLI, Session 82)**
- [KOD] ✅ **Bootstrap script (#260 `3cd09f4`)**: `apps/api/scripts/bootstrap-prod.ts` — idempotent (slug doğal anahtar, sabit UUID yok), 9/9 test; **prod'da koşuldu**: tenant **DİLAN PİDE** (`dilan-pide`, `TENANT_ID=e94739ac-...`) + admin (`ilhanavci499@gmail.com`) + tenant_settings(timezone) + ilk `agents` satırı; agent API key `/root/pos-secrets.env` → `PRINT_AGENT_API_KEY` (P5-4 kurulumunda kullanılacak); `TENANT_ID` api.env'e eklendi ✓; **canlı login smoke ✓** (curl 200 + doğru tenant/role token)
- [DOCS] ✅ `docs/compliance/kvkk-data-inventory.md` (#262) — go/no-go kapısı yazıldı (fan-out envanter + 3 adversarial mercek); §11 açık 🔴: m.9 aktarım(#2)/aydınlatma(#3)/backup(#4)/phone-kardinalite(#6)/dry-run(#7); §12 v5.1 KABUL boşluk (anonymizeCustomer/VERBIS/aydınlatma/açık-rıza)
- [USER] ✅ v3 `Müşteriler.xlsx` export sağlandı (1475 satır; başlıklar v5 import ile birebir). Analiz: `docs/v3-reference/customer-data-and-export.md`
- [OPS] ✅ **MÜŞTERİ IMPORT CANLI** — kullanıcı web-UI "Excel'den İçe Aktar" ile prod'a import etti; prod doğrulandı (read-only): **1469 müşteri / 1008 telefon / 124 adres**, `customer_import.completed` audit (created 1469, errors 0). go/no-go #6 (kardinalite: tek telefon, 87 mükerrer skip) + #7 (dry-run temiz) + #8 (audit) ✅
- [OPS/USER] **Masalar 25/25 ✅ · Menü ✅ CANLI (67 ürün/9 kategori, S84 SQL girişi; `areas=1` — bölge ayrımı isteniyorsa ekle)** · ✅ personel kullanıcıları (S86 prod: 2 admin + 1 garson) · ✅ kara liste boş (0; ihtiyaç oldukça elle işaretlenir)
- [USER/hukuki] ⏳ KVKK aydınlatma + m.9 Almanya aktarım dayanağı (#2/#3) — **S86: paket execute-hazır** ([ALANLAR] dolu + güncel mevzuat teyidi; VERBİS muaf). 🚩 Hetzner Türk-SCC imza belirsizliği = avukat düğümü. Kalan = avukat onayı+tesis+yayın
- **DoD:** ✅ `TENANT_ID` env · ✅ müşteri import (1469, prod doğrulandı) · ✅ menü/masa/kullanıcı canlıda (S86) · ⏳ KVKK aydınlatma

### P5-3 — Backup sunucu ayakları (hedef: `backup-strategy.md` §9 yeşil)
**Durum (S84): kod tarafı ✅ (#284, ADR-023 Amd1)** — DR adversarial 4 sorun buldu+düzeltildi: DB adı `pos_prod` + systemd yolu `apps/api/scripts/backup/` + **rclone sync→COPY** (sync off-site'ı 14 güne düşürüp eskiyi siliyordu = DR veri-kaybı tuzağı; copy+`--min-age 180d` prune) + PGHOST boş=socket/peer (gece sessiz auth-fail riski). Kalan 6 sunucu ayağı Storage Box'a bloke (yol haritası A3).
- [OPS] script sunucuda `.age` üretimi + `rclone` copy Storage Box
- [OPS] systemd timer aktif + retention silme doğrulaması
- [OPS] ilk SUNUCU restore drill (throwaway DB) → §8 tabloya işle
- [USER] age private key kasa + offline + sunucudan kaldır
- **DoD:** gece dump→age→off-site otomatik, sunucu restore drill exit 0, key kasada

### P5-4 — Restoran istasyonu + mobil dağıtım (hedef: yazıcı+KDS+garson cihazı hazır)
**Durum (S83): mobil ✅ + MUTFAK YAZICISI ✅ (CP857 Türkçe canlı doğrulandı). Kalan: kasa USB agent + KDS/Caller Bridge.**
- ✅ [KOD] Mobil prod API URL config + EAS release APK (#275/#276); sideload + canlı smoke GEÇTİ; keystore kasada
- ✅ [OPS] **MUTFAK agent** MSI kur + config (JP80H Ethernet 192.168.1.120, jobKinds:["kitchen"]) + API env nssm ile + Türkçe fiş DOĞRU (#280 CP857 fix: **ESC t 29**, 13 değil). ADR-032 ikincil routing (#277) + install-second-agent.ps1 (#278)
- ⏳⛔CUTOVER [OPS] **KASA (USB) agent** — kasa yazıcısı (POS-80, USB-only, mutfaktan FARKLI model) **canlı Adisyo'da** (S84 Zadig kazası geri alındı — memory `project_kasa_printer_adisyo_shared`) → Zadig+kurulum YALNIZ cutover günü (yol haritası B2-B4). Kod hazır: **ADR-004 Amd3 (#282 PROD'DA)** kasa fişi ESC t 61 üretir (61 `Doğrulanmamış` — cutover'da codepage-scan teyit); `install-second-agent.ps1 -JobKinds bill` + VID/PID
- ✅ [KOD] **Ödeme→otomatik fiş (PR-7c, #283 PROD'DA)** — `pay_and_print`/`pay_and_print_close` otomatik `bill` enqueue (post-commit best-effort + `!replayed` çift-baskı guard + CP857-throw izolasyonu; web "fiş yazdır" sessiz no-op bug'ı kapandı). Kasa agent kurulunca fiziksel basar. Ayrı chip: zaten-tam-ödenmiş PATCH-kapanış yolu fiş basmaz
- ✅ [OPS] **CALLER ID CANLI (S86)** — dükkan PC `C:\restoran-pos\caller-bridge` servis + 4 prod fix (#300-303) + istasyon=İlhan + canlı popup ✓; ~~KDS~~ (S86 karar: kağıt fiş) · ⏳ kasiyer istasyonu (kiosk) cutover'da
- **DoD:** ✅ mutfak fişi Türkçe doğru (charter :125) · ✅ garson cihazından sipariş→mutfak<2sn (mobil smoke) · ⏳ kasa adisyon (cutover) · ✅ **Caller ID popup smoke (S86 canlı — arayan müşteri eşleşmeli popup)**

### P5-5 — Go-live + stabilizasyon (hedef: v5 ana sistem)
- [OPS] Deploy sonrası smoke: web kasiyer/müdür/mutfak KDS + mobil + yazıcı + realtime iki-yön + Caller ID popup
- [OPS] Go/no-go: charter :125/:129-136 canlıda doğrula (Nginx `$request_time` p95 script + `pm2 describe` restart 0)
- [USER] Personel eğitimi + kağıt-fallback 1-sayfa şablonu + prosedürü
- [OPS] Cutover **gün sonunda** (order_no 1'den; ADR-031 K6)
- [DOCS] charter :124 (paralel-koşum kriteri) + :194-201 güncelle · ADR-003 §14.1.B.3 / ADR-001 §7.1/§7.2 + order_no/takeaway forward-ref in-place notları · context-anchor §2
- [USER] Adisyo 2-4 hafta açık tut → kriterler sağlanınca iptal (rollback eşiği: >30dk sipariş yok / veri şüphesi → Adisyo'ya dön)
- **DoD:** ADR-031 DoD (a-j) tamam; monitoring minimal (pino+Nginx log+günlük pm2+haftalık `rclone lsl`)

### P5-6 — CONCURRENTLY gate (yalnız go-live SONRASI ilk canlı-veri migration'ı gerektiğinde)
- [KOD] Enforcement gate PR (002-005 index whitelist + CI regex) + db-migration-guard kuralı: canlı-veri ilk migration PR'ı bu gate merge edilmeden merge edilemez (ADR-031 K12)
- **DoD:** gate CI'da aktif; ilk canlı index migration'ı CONCURRENTLY ile geçti

## Açık sorular / kullanıcı aksiyonları (ADR-031)

1. ~~Hetzner hesabı/domain envanteri~~ ✅ **KAPANDI (S81):** Hetzner hesabı vardı; restoranpos.org alındı
2. **v3 taze Excel export** — güncel v3 DB'den `Müşteriler.xlsx`; v3 PC'de açılıyor mu + export yolu
3. **v3 defteri bayatlık teyidi** — Adisyo dönemi müşterileri taşınmaz (bilinçli kabul)
4. **Kara liste kaynağı** — v3 export'unda ayrı kolon var mı; yoksa canlıda elle
5. ~~Garson cihaz envanteri~~ ✅ **KAPANDI (S81):** 1 Android (ilk test fazı — kullanıcı kendisi deneyecek) + 5 iOS (sonraki faz; iOS dağıtımı Apple Developer ~$99/yıl + TestFlight gerektirir — Android stabilize olunca ayrı iş kalemi)
6. **Adisyo iptal tarihi** — go-live kriterleri + 2-4 hafta
7. **age key + APK keystore kasası** — parola yöneticisi + offline

## Kapsam dışı (v5.1+) — ADR-031

CI/CD otomasyonu + `rotate-migrator.yml` · alerting/metrics/APM/uptime · yük testi · WAL/PITR · restore UI · code signing · Print Agent Manager UI · Caller Bridge WiX bundle · RLS · Redis Socket.IO adapter · PM2 cluster · veresiye · KVKK `anonymizeCustomer` · store/TestFlight + Play App Signing · menü/masa/kara-liste import scripti · CX32.

## Ortam & dev-loop (Session 74/76 reçetesi)

- **Windows native PostgreSQL 17.10** `D:\PostgreSql` (servissiz → `Start-Process pg_ctl` detach + WAL-recovery poll [[feedback_native_postgres_detached_start]]). İki DB: **`pos_dev`** (dev/device) / **`pos_test`** (test — `DELETE FROM tenants`, ayrı [[feedback_local_test_db_separate]]).
- Dev-loop: API `pnpm --filter @restoran-pos/api dev` (:3001) · web `pnpm --filter @restoran-pos/web dev` (:5173) · Metro `EXPO_NO_DEPENDENCY_VALIDATION=1 EXPO_OFFLINE=1 REACT_NATIVE_PACKAGER_HOSTNAME=192.168.1.88 expo start --lan` → `exp://192.168.1.88:8081` (Expo Go [[feedback_mobile_expo_go_devloop]]).
- Login: admin@local.test/admin1234 · garson@local.test/garson1234.
- Lokal test: `DATABASE_URL="postgresql://postgres:postgres@localhost:5432/pos_test" pnpm --filter @restoran-pos/api test` (~627 PASS, bu oturumda koşulmadı). **CI hâlâ tek otorite** — kod PR'ında merge öncesi CI yeşilini POLL et [[feedback_merge_wait_ci_no_required_checks]].

## Çalışma kuralları (değişmez — CLAUDE.md)

- ADR önce, kod sonra. DoD olmadan "bitti" yok. Branch-first. Cerrahi değişiklik.
- UI → hci+turkish-ux+i18n. Auth/payment/PII → security-reviewer. DB şema → db-migration-guard (enum migration'da incremental senaryoyu lokalde test et [[feedback_enum_migration_incremental_test]]).
- Kapsam kilidi: v5.0 MVP'de yoksa v5.1 backlog veya ADR.
- Ultracode açıksa: substantive iş → Workflow ile implement → adversarial verify.
