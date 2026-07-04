# Aktif Plan — Phase 5: Pilot Go-Live + Adisyo→v5 Geçişi + v3 Müşteri Taşıma

> Bu dosya o an üzerinde çalıştığımız sprint'in tek kaynağıdır. Phase/sprint değişince **tamamen yenilenir**.
> Tüm faz roadmap'i: `docs/project-charter.md` → "Faz Roadmap". Geçmiş detay: git history + memory `project_session_*_summary.md`.
> Bu fazın tam kararları: `.claude/memory/decisions.md` → **ADR-031** (14 karar + sprint + DoD).

**Son güncelleme:** 2026-07-04 (Session 81 devamı — **P5-1 TAMAMLANDI + P5-2 bootstrap ayağı CANLI**: https://restoranpos.org yayında, admin login çalışıyor)
**main HEAD:** `3cd09f4` (#260 bootstrap script) · **0 açık PR** · Session 81 = ADR-031 (#257/#258) + deploy runbook (#259) + bootstrap script (#260) + prod go-live altyapısı
**▶ SIRADAKİ: P5-2 kalanları — [DOCS] `kvkk-data-inventory.md` (müşteri PII import'undan ÖNCE, go/no-go) + [USER] v3 `Müşteriler.xlsx` export + [OPS] import + menü/masa/kullanıcı ELLE giriş; sonra P5-3 backup sunucu ayakları**

## Durum: Phase 0-4 ✅ · Phase 5 🔄 **P5-1 ✅ KAPANDI** (prod CANLI) · P5-2 kısmen (bootstrap ✅, veri/doküman kaldı)

**Gerçeklik değişimi (ADR-031):** Restoran ŞU ANDA **Adisyo** kullanıyor, v3 kullanım dışı. Charter'ın "2 hafta paralel (v3 ana/v5 yedek)" varsayımı GEÇERSİZ → geçiş **Adisyo→v5 doğrudan go-live**. Kod yazılmadı; her KOD işi aşağıda PR olarak planlı, taze oturumlara bırakıldı.

| Faz | Durum |
|---|---|
| Phase 0-2 | ✅ |
| Phase 3 Sipariş+Mutfak+Ödeme+Yazıcı+Rapor | ✅ (Session 70, tag `v0.3.0`) |
| Phase 4 Mobil + Caller ID + Audit + Yedek | ✅ (mobil operasyonel terminal + masa-yönetimi ailesi ADR-027/028/029; Faz B kalanı = ADR-030 rezerv v5.1) |
| **Phase 5 Pilot + Migration** | 🔄 **P5-1 ✅** (restoranpos.org CANLI) · P5-2 kısmen · P5-3..6 bekliyor |

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

### P5-2 — Prod bootstrap + KVKK inventory + veri taşıma 🔄 **KISMEN (bootstrap ayağı ✅, Session 81)**
- [KOD] ✅ **Bootstrap script (#260 `3cd09f4`)**: `apps/api/scripts/bootstrap-prod.ts` — idempotent (slug doğal anahtar, sabit UUID yok), 9/9 test; **prod'da koşuldu**: tenant **DİLAN PİDE** (`dilan-pide`, `TENANT_ID=e94739ac-...`) + admin (`ilhanavci499@gmail.com`) + tenant_settings(timezone) + ilk `agents` satırı; agent API key `/root/pos-secrets.env` → `PRINT_AGENT_API_KEY` (P5-4 kurulumunda kullanılacak); `TENANT_ID` api.env'e eklendi ✓; **canlı login smoke ✓** (curl 200 + doğru tenant/role token)
- [DOCS] ⏳ `docs/compliance/kvkk-data-inventory.md` (**müşteri PII import'undan ÖNCE** — go/no-go ön-koşulu; ADR-016 PR-8e drift kapanışı)
- [USER] ⏳ v3 PC'den taze `Müşteriler.xlsx` export (v3 açılıyor mu + export yolu teyidi)
- [OPS] ⏳ `import-v3-customers.ts --dry-run` → doğrula → `--batch` (legacy_v3_no idempotent, dedup)
- [OPS/USER] ⏳ Menü + masa/bölge + kullanıcılar ELLE gir; kara liste ELLE işaretle (`is_blacklisted` + reason)
- **DoD:** ✅ `TENANT_ID` env = bootstrap UUID · ⏳ müşteri export=import satır sayısı + dedup · ⏳ menü/masa/kullanıcı canlıda

### P5-3 — Backup sunucu ayakları (hedef: `backup-strategy.md` §9 yeşil)
- [OPS] script sunucuda `.age` üretimi + `rclone` sync Storage Box
- [OPS] systemd timer aktif + retention silme doğrulaması
- [OPS] ilk SUNUCU restore drill (throwaway DB) → §8 tabloya işle
- [USER] age private key kasa + offline + sunucudan kaldır
- **DoD:** gece dump→age→off-site otomatik, sunucu restore drill exit 0, key kasada

### P5-4 — Restoran istasyonu + mobil dağıtım (hedef: yazıcı+KDS+garson cihazı hazır)
- [OPS] Print Agent MSI kur + apiKey (bootstrap plaintext key) config'e gir
- [OPS] Ethernet TCP 9100 birincil + USB fallback (Zadig WinUSB); her iki yazıcıda `ESC t 13` CP857 codepage scan (Türkçe fiş doğrula)
- [OPS] KDS ekran cihazı + kasiyer istasyonu: tarayıcı, otomatik başlatma, ekran uyku/güç-tasarrufu KAPALI, KDS tam ekran
- [OPS] Caller Bridge (.NET 8) manuel kur + `BRIDGE_TOKEN` eşleştir (opsiyonel değil, smoke'a girer; go-live blocker DEĞİL)
- [KOD] Mobil prod API URL config (app config/env) + Android release APK build (EAS veya lokal gradle; **sabit self-signed keystore** — kasada) — PR
- [OPS] APK sideload garson cihazlarına; mobil-internet HTTPS bağlantı testi
- **DoD:** fiş Türkçe doğru bastı (charter :125), garson cihazından sipariş→mutfak <2sn, Caller ID popup smoke

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
