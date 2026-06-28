# Changelog

Bu dosya her önemli değişikliği tarih sırasıyla kaydeder. `/phase-done` ve `/new-adr` slash command'ları bu dosyayı otomatik günceller.

Format: [Keep a Changelog](https://keepachangelog.com/tr/1.1.0/).

Sürüm şeması: Phase 0 → 0.0.x, Phase 1 → 0.1.x, pilot → 0.9.x, prod → 1.0.0.

## [Unreleased]

## [0.3.0] - 2026-06-27

İlk resmi sürüm etiketi (`v0.3.0`). Sürüm şeması gereği Phase 3 → `0.3.x` (Phase N → `0.N.x`; pilot → `0.9.x`; prod → `1.0.0`). Bu sürüme kadar (Session 1-70) yapılan her şey bu release altında toplanır.

**Phase 0-3 tamamlandı — backend + web + Print Agent + Caller ID production-deployable:**
- Çekirdek domain + JWT auth + PostgreSQL şema + repository katmanı (Phase 1)
- REST API + Socket.IO realtime + web UI: kasiyer/müdür/mutfak ekranları (Phase 2)
- Sipariş alma + paket servis + mutfak ekranı (KDS) + ödeme (parçalı/ikram/iptal) + 10 rapor (Phase 3)
- Print Agent: Windows servisi, USB + TCP ESC/POS, CP857 Türkçe, MSI installer (Phase 3, gerçek donanım smoke ✅)
- Caller ID: gelen arama → müşteri tanıma (.NET köprü servisi) + müşteri yönetimi
- Otomatik DB yedek (pg_dump + age + Storage Box, Session 70)

> Sırada: Phase 4 mobil garson uygulaması (sıfırdan) + audit coverage tamamlama. Pilot → `0.9.x`.

### Session 70 (2026-06-27) — Phase 3 9/9 closure + kalite denetimi (5 PR)

**Phase 3 tamamen kapandı + 43 gün sonra dönüş denetimi.** PR-5b USB transport gerçek donanımda doğrulandı, ardından 5 adversarial sub-agent ile kalite/risk denetimi yapıldı (2 🔴 + 3 🟠 bulgu, hepsi kapatıldı). Tüm fix'ler 0 CI fix iterasyonu.

- **Phase 3 9/9 ✅ closure** (PR #192): PR-5b USB real-printer smoke DoD §D — gerçek STM32 POS-80 yazıcı (vid=0x0483 pid=0x5743), Zadig WinUSB driver + codepage `ESC t 13 = CP857` donanım-doğrulaması. ADR-004 §Phase 3 PR-5b §H.
- **🔴 Ödeme correctness** (PR #193): `/payments *_close` ödeme tutarını sipariş toplamıyla doğrulamıyordu (100 TL adisyon 50 TL ile kapanabiliyordu; `canCloseOrder` ölü koddu). ADR-014 §12 — tx içi enforcement, underpaid→`PAYMENT_INSUFFICIENT_FOR_CLOSE`, overpaid→yeni `PAYMENT_EXCEEDS_TOTAL`, ikisi de 400 + rollback. 5 integration test.
- **🔴 Print job dayanıklılık** (PR #194): retry job hiç requeue edilmiyordu + stuck printing reclaim yoktu → yazıcı/agent aksaklığında mutfak fişi kalıcı kaybı. ADR-004 §Amendment 3 + Migration 039 (`retry_at`) — lazy requeue + reclaim claim sorgusu içinde (cron'suz, attempts'a dokunmadan, anti-starvation). 6 integration test.
- **🟠 Güvenlik** (PR #195): `/agent/register` + `/agent/refresh` rate-limit'siz (apiKey brute-force + bcrypt DoS) → `agentAuthLimiter` 30/15dk-IP.
- **🟠 KDS reconnect** (PR #196): Socket.IO koparsa mutfak ekranı stale kalıyordu (kaçan event replay edilmiyor) → `connect` event'inde KDS invalidate resync (ADR-010).
- **Doc hijyen** (PR #197): active-plan.md 938→53 satır yenilendi (Phase 1'de takılıydı); ADR-016 Caller ID Proposed→Accepted (shipped); ADR-006 §5.2 Sprint 13 payment kod backfill.

### Session 69 (2026-05-14/15) — Print Agent Phase 3 PR-5b USB transport + ADR-022

**Phase 3 9/9 kod tamam.** Son sub-PR USB transport yazıldı (smoke Session 70'te); Print Agent v5.1+ backlog roadmap'i ADR-022 ile kayda geçti.

- **PR-5b USB transport** (PR #191): `apps/print-agent/src/printer/usb-transport.ts` (node-usb, findByIds→open→claim→bulk-out endpoint→transfer settle pattern) + config `z.discriminatedUnion('type', [TcpSchema, UsbSchema])` + agent loop dispatch (usb|tcp); 19 unit test (vitest `usb` mock). Gerçek donanım smoke Session 70'e ertelendi.
- **ADR-022 Accepted** (PR #190): Print Agent v5.1+ Backlog Roadmap — M1-M6 (Event Log, Logging rotation, Icon, Code signing, MSI deterministic, SEA migration).
- **Cleanup** (PR #189): lokal helper ps1 gitignore + orphan worktree/branch disposal.

### Session 68 (2026-05-14) — Print Agent PR-6 MSI installer production-ready closure

**Added:**
- `apps/print-agent/installer/vendor/nssm.exe` — 368KB win64 binary (winget NSSM.NSSM 2.24-101-g897c7ad), repo'da vendored (offline + deterministic CI build) (PR #184, sha `13c9ec4`)
- `.github/workflows/print-agent-msi.yml` artifact upload — `print-agent-msi` (workflow_dispatch + tag `print-agent-v*`), windows-latest runner; lokal+CI artifact 18.3MB (run 25858000242)
- 5 yeni memory ders dosyası: `feedback_ci_workflow_audit_first`, `feedback_local_msi_smoke_faster`, `feedback_pkg_yao_migration`, `feedback_vendor_in_repo_binary`, `feedback_wix_cwd_resolve` (auto memory)

**Changed:**
- `apps/print-agent/package.json` — `@vercel/pkg@5.8.1` (deprecated, sadece node18 destekli) → `@yao-pkg/pkg@^6.4.0` (drop-in fork, node22 destekli). `pkg` field schema package.json'a gömüldü (`pkg.config.json` ayrı dosya silindi). Target `node22-win-x64` (PR #181, sha `956e4cf`)
- `apps/print-agent/installer/.gitignore` — `!vendor/nssm.exe` negation eklendi (root `*.exe` ignore'unu override)
- `.github/workflows/print-agent-msi.yml`:
  - `Setup pnpm` adımı `version: 9` parametresi silindi (ERR_PNPM_BAD_PM_VERSION fix; PR #177)
  - `TypeScript compile` adımı `pnpm turbo run build --filter='@restoran-pos/print-agent...'` (workspace deps; PR #178)
  - `Install nssm` adımı silindi → `Verify vendored nssm.exe` (sanity check; PR #184)
  - `Build MSI` adımı `working-directory: apps/print-agent/installer` (WiX path CWD'den çözer; PR #185)

**Fixed (9 ardışık CI fix PR):**
- PR #177 `9a4f528` — pnpm version conflict (workflow `with: version: 9` + package.json `packageManager` çatışması)
- PR #178 `06f743b` — workspace deps build edilmedi (tek paket filter → turbo `--filter='X...'`)
- PR #179 `396473d` — pkg config parse hatası (`package.json + --config pkg.config.json` çatışması)
- PR #180 `9778690` — pkg target node20 (pkg 5.8.1 node20'i de desteklemiyor — yetersiz)
- PR #181 `956e4cf` — `@vercel/pkg` → `@yao-pkg/pkg` migration (kalıcı çözüm, pkg ✅)
- PR #182 `12d382a` — nssm.cc 503 Service Unavailable (kalıcı down) → chocolatey install
- PR #183 `e75becc` — nssm path search recurse + PATH fallback (windows-latest case sensitivity, yetersiz)
- PR #184 `13c9ec4` — nssm.exe **vendor in repo** (offline + deterministic kalıcı çözüm)
- PR #185 `73e783f` — WiX build CWD = installer/ (`<File Source="..."/>` path'leri çalışma dizininden çözer)

**Verified (E2E DoD):**
- Lokal pkg build → `print-agent.exe` 62.5MB (PE32+ x86-64 Windows console)
- Lokal WiX v4 build → `print-agent-0.0.1.msi` 18.3MB
- MSI install (UAC) → Service `RestoranPosPrintAgent` kuruldu (Status: Paused = config apiKey eksik beklenen), config template `%PROGRAMDATA%\restoran-pos\print-agent.json` kopyalandı, install dir `%PROGRAMFILES%\Restoran POS\Print Agent\`
- MSI uninstall (UAC + Restart Manager) → service kalktı, install dir silindi, **config dosyası KORUNDU** ✅ (re-install dostu)
- CI MSI build (10. run, sha `73e783f`) → 11/11 step SUCCESS, artifact 18.3MB

**Print Agent Phase 3 8/9 sub-PR ✅:** PR-1 skeleton (#162) / PR-2 state machine (#164) / PR-3a auth backbone (#166) / PR-3b client flow (#168) / PR-4a render primitives (#170) / PR-4b KDS enqueue (#171) / PR-5a TCP transport (#173) / PR-6 MSI installer (#175 yazıldı + Session 68 9 CI fix ile production-ready). **PR-5b USB transport** lokal donanım eşliğine ertelendi.

**Phase 4 forward-refs:** event log + structured logging rotation, icon, code signing (Authenticode), MSI deterministic/reproducible build, auto-update channel, `@yao-pkg/pkg` → Node 22 SEA migration ADR amendment.

---

### Session 67 (2026-05-14) — Print Agent PR-6 MSI installer + nssm Windows servisi

**MSI paketleme:** Print Agent artık tek `print-agent-{version}.msi` artifact'ı olarak paketlenip Windows servisi (`RestoranPosPrintAgent`) olarak kuruluyor. v3 StoreBridge'in yerini alan agent'ın production-deployable hale gelmesi (PR #175, sha `c54ab04`). ADR-004 §Phase 3 PR-6 scope kilidi + 4 karar matrisi (nssm embed CC0 / `%PROGRAMFILES%\Restoran POS\Print Agent\` x64 perMachine / windows-latest + WiX v4 dotnet tool / LocalSystem servis account).

- 9 yeni dosya (PR #175): `package.json` pkg devDep + `build:emit`/`build:exe` script'leri, `tsconfig.json` (`noEmit:false` + `resolveJsonModule`), `pkg.config.json` (`node22-win-x64`), `src/version.ts`, `installer/print-agent.wxs` (WiX v4 ~225 satır, modern `Scope="perMachine"` syntax, 13 CustomAction), `installer/print-agent.config.json.template` (PR-5a `PrinterConfig` schema uyumlu), `installer/build-msi.ps1`, Türkçe kurulum + sorun giderme README (142 satır), `.github/workflows/print-agent-msi.yml` (windows-latest, `workflow_dispatch` + `print-agent-v*` tag trigger).
- WiX servis kurulumu config dosyasını re-install'da KORUR (uninstall'da `StopService` + `RemoveService`, config silinmez) — re-install dostu.
- Tool kilidi `pkg + nssm + WiX` (ADR-004 §5 değişmedi). Out-of-scope v5.1 backlog: icon, code signing, auto-update channel, MSI bundle Caller Bridge.
- **4. ardışık 0 fix iter** (PR-3b → PR-4a → PR-5a → PR-6); single-pass pattern güçlendi.

### Session 66 (2026-05-16) — Print Agent PR-5a TCP 9100 transport + config loader

**Gerçek yazıcı transport (TCP):** Agent artık cloud'dan çektiği print job'u TCP 9100 üzerinden ağ yazıcısına basıyor; PR-3b'deki dummy success kalktı, gerçek transport sonucu raporlanıyor (PR #173, sha `457ab59`). USB kısmı (PR-5b) lokal donanım + kullanıcı eşliği gerektirdiği için ertelendi (ADR-004 §5).

- `apps/print-agent/src/printer/config.ts` — `PrinterConfig` zod schema + `loadPrinterConfig()` 4-yol öncelik (env path → `%PROGRAMDATA%` → `~/.restoran-pos` → env compose), fail-fast (PR #173).
- `apps/print-agent/src/printer/tcp-transport.ts` — `sendToTcpPrinter(bytes, config)`, `net.Socket` connect+write+end; timeout/ECONNREFUSED/EPIPE → reject Error (PR #173).
- Agent loop entegrasyonu (`src/index.ts`): job alındı → `payload.bytesBase64` decode → `sendToTcpPrinter` → try/catch → `reportResult('success'|'failed', errMsg?)`.
- 10 unit test (config 6 + tcp-transport 4, mock `net.createServer`, sandbox-only) PASS; 0 fix iter single-pass.

### Session 65 (2026-05-15) — Print Agent PR-4a render primitives + PR-4b KDS enqueue

**Cloud-side render + KDS akışı:** Mutfak fişi artık cloud tarafında ESC/POS byte stream'e (CP857) render ediliyor ve sipariş açıldığında otomatik print job kuyruğa giriyor — agent dumb-client (PR #170 sha `9e3a9e0`, PR #171 sha `56f4527`). ADR-004 §4 cloud-render kararının hayata geçişi.

- `packages/shared-domain/src/printer/encode-cp857.ts` — CP857 encoder, ASCII fallback YASAK (ADR §7); `esc-pos.ts` komut helper'ları (RESET, CODEPAGE, CUT_FULL, align, printMode, feed, concat); `apps/api/src/print/templates/kitchen-receipt.ts` — `renderKitchenReceipt(params)` → `Uint8Array`. 34 pure unit test (25 domain + 9 template), DB-bağımsız, 0 fix iter (PR #170).
- `apps/api/src/print/enqueue-kitchen-job.ts` helper (transaction-scoped); `orders.ts` dine_in + takeaway hook'larına çağrı; payload JSONB `{ kind:'kitchen', bytesBase64, meta:{...} }`; 3 integration test (dine_in / takeaway / drink-only) (PR #171).
- **Migration 038** (PR #171): `print_jobs.tenant_id` FK ON DELETE CASCADE fix — yeni hook mevcut `DELETE FROM tenants` cleanup'ında 23503 patlatıyordu (13 test fail iter 1); CASCADE ile çözüldü.

### Session 64 (2026-05-14) — Print Agent PR-3a auth backbone + PR-3b client flow

**Gerçek auth (Bearer JWT):** Mock auth (`X-Tenant-Id` header) tamamen kaldırıldı; agent register → refresh → Bearer JWT poll → result POST end-to-end auth flow ile çalışıyor (PR #166 sha `58fb6bc`, PR #168 sha `19c382d`). ADR-004 Amendment 2: agents şema + API key format (`pk_${tenantIdShort}_${random}`) + JWT payload (`type='agent'`, ayrı `JWT_AGENT_SECRET`).

- **Migration 037** (PR #166): `agents` tablosu (8 kolon, FK CASCADE, UNIQUE `(tenant_id, device_fingerprint)`, 2 partial index, 9 COMMENT). Cloud register/refresh endpoint + Bearer JWT middleware; PR-1/PR-2 mevcut endpoint'ler de Bearer JWT'ye migrate edildi. Etki: 30 dosya, +1130/-16 (21 test fixture'a `agentSecret` eklendi).
- Agent client end-to-end flow (PR #168): in-memory `AgentSession`, ENV migrate `PRINT_AGENT_TENANT_ID` → `PRINT_AGENT_API_KEY`, result POST dummy success (file persist Phase 4+ MSI'ye ertelendi); single-pass, 0 fix iter.
- 2 CI fix (PR #166): `migration-check` (`COMMENT ON TABLE` codegen JSDoc üretmez — kaldırıldı) + `Playwright` (`JWT_AGENT_SECRET` env e2e.yml'ye eklendi, yoksa API start `throw`).

### Session 63 (2026-05-14) — Print Agent Phase 3 PR-1 skeleton + PR-2 state machine

**Print Agent rewrite başlangıcı:** v3 StoreBridge'in sıfırdan TypeScript yeniden yazımı başladı (multi-week eksen). PR-1 agent skeleton + cloud job long-poll endpoint, PR-2 job result + state machine (PR #162 sha `3e15dd9`, PR #164 sha `8d99b6e`). ADR-004 Phase 3 PR-1 scope kilidi (whitelist'li dosya + endpoint + enum drift flag).

- `apps/print-agent/` skeleton — 5sn polling loop, `console.log` dummy, printer transport YOK (Phase 4+); `packages/shared-types/src/print-agent.ts` 4 endpoint zod schema (PR #162).
- Cloud `GET /print/v1/jobs/next?wait=N` — long-poll, mock auth (`X-Tenant-Id`), atomik `UPDATE ... FOR UPDATE SKIP LOCKED`; 2 integration test (queued→200+printing, no job→204) (PR #162).
- `POST /jobs/:id/result` + state machine `printing→success/failed/retry` + attempts kolonu; `cancelled`/`retry` lifecycle kilitlendi (PR #164).
- **0 fix iter** (PR-1, Session 62'deki 6 iter'a göre büyük gelişme): net architect scope kilidi + tam implementer brief.

### Session 62 (2026-05-13) — Sprint 13 son borç: S7 Mod B E2E skip kaldırma

**Sprint 13 kapanışı.** Ödeme akışının son açık borcu — "Masayı Kapat" (Mod B) E2E iskeletindeki 3 skip senaryosu — doldurularak Sprint 13 tamamen kapatıldı. ADR-014 §10.4 Mod B artık tam örtülü: 5 backend integration + 3 E2E. Tek PR (#160), 6 dosya değişti.

**Süreç dersi.** 6 CI iterasyonu gerekti; root cause'lar kademeli ortaya çıktı (idempotency_key uuid kolonu, Zustand persist drift, Sidebar mobile-menu backdrop'ın pointer intercept etmesi). Trigger kontratı geç fark edildi: kart kökü sipariş ekranına gider, modal'ı 3-nokta dot açar. Sub-agent (Explore) + main context paralel teşhisi overlay kaynağını dakikalar içinde buldu; lokal Playwright UI keşfinin kullanıcı eşliğinde yapılması gerektiği yeniden doğrulandı.

- Sprint 13 PR-3 (PR #160): "Masayı Kapat" Mod B E2E senaryoları aktifleşti; ödeme akışı tam test örtüsüne kavuştu. `QuickPaymentModal`, `TableActionsModal`, `TableCard`'a `data-testid` eklendi, seed'e 3 sipariş + 3 kalem + 2 ödeme fixture geldi.

### Session 61 (2026-05-13) — Raporlar anomaly scope: comp + void (ADR-015 Amendment 3)

**Anomali raporu kapsam genişlemesi.** İptal raporundaki anomali tablosu artık yalnız cancel değil, comp (ikram) ve void (iptal-sonrası geri alma) kalemlerini de gösteriyor. ADR-015 Amendment 3 ile 7 karar netleşti: scope = cancel+comp+void, comp DB-direct (item-level granularity), void DB-direct (future-proof), alan-bazlı doluş matrisi; domain emit eklenmedi (kapsam kilidi korundu). Tek PR (#158).

**Şema drift düzeltmesi.** Kod yazımı sırasında `order_items.updated_at` kolonunun 000_init + Migration 019/020/021'de hiç eklenmediği keşfedildi (orders'da vardı, items'da yoktu). Migration 035 prereq olarak yazıldı: kolon eklendi, `updated_at = created_at` backfill yapıldı, orders paritesinde `BEFORE UPDATE` trigger kuruldu.

- ADR-015 Amendment 3 (PR #158): Anomali raporuna comp/void verisi aktı; reports.test anomaly bloğu 11 → 17 test (+6: 3-tip, sadece comp, sadece void, cross-tenant, range edge, CSV). Migration 035 ile order_items.updated_at drift'i kapatıldı.

### Session 60 (2026-05-12) — Raporlar feature %100: frontend tamamlanması + tarih aralığı (Sprint 14 PR-5/6/7 + Sprint 15)

**Raporlar ekranı tamamlandı.** Session 58'de biten backend'in (13 endpoint + CSV) üzerine frontend %100 oturtuldu: KPI tile'lar HCI ciladan geçti, 3 grafik paneli (saatlik ciro, ödeme dağılımı, çok satanlar) + 3 detay tablosu (kategori satışları, kullanıcı performansı, anomaliler) eklendi, CSV indir ve Z/X (gün kapanışı / anlık özet) butonları bağlandı. Raporlar artık Charter Phase 3 madde 5 olarak tam kapandı. 11 PR (#146-#156).

**Tarih aralığı (range) özelliği.** Sprint 15 ile raporlara `today/yesterday/last7/last30/custom` aralık seçimi geldi (ADR-015 Amendment 2). Backend `resolveRangeWindow()` helper'ı 8 KPI endpoint'ini destekliyor, custom aralık max 90 gün; Z/X dokunulmadı. Frontend'e modern tarih seçici (Popover + Calendar) eklendi, 11 hook ve 6 panel range prop'una bağlandı, CSV indirme aralığa duyarlı hale geldi.

**Yeni UI primitive'leri.** Radix Tooltip (touch-friendly, KpiTile için), Radix Popover ve react-day-picker v9 tabanlı Calendar (TR locale, 44px Fitts hedefi) eklendi. HCI BLOCKER'lar düzeltildi: focus-visible ring WCAG AA (stone-500 + offset), tarih butonu 44px.

- Sprint 14 PR-5b2/5c (PR #146-#148): 3 grafik paneli + 3 detay tablosu; raporlar ekranı görsel olarak tamamlandı.
- Sprint 14 PR-5d/5e (PR #149-#150): CSV indir + Z/X butonları, final HCI cilası; Sprint 14 PR-5 kapandı.
- Sprint 14 PR-6/7 (PR #151-#152): CSV başarı toast'ı, "Gün kapanışı al?" bağlamsal etiket, KpiTile Radix Tooltip primitive + WCAG düzeltmesi.
- Sprint 15 PR-1/2 (PR #153-#154): Backend range parametresi (ADR-015 Amendment 2) + frontend RangeFilter (Popover + Calendar) + 11 hook range wire.
- Sprint 15 PR-3/4 (PR #155-#156): 6 panele range prop plumbing + CSV indir butonlarına range desteği; Raporlar range feature tamam.

### Session 59 (2026-05-11/12) — Raporlar UI iskeleti + PageHeader tutarlılık standardı

**Raporlar ekranı açılışı.** Sprint 14 backend bitti, frontend başladı: `/raporlar` route iskeleti (Sidebar etkin + RangeFilter + boş durum) ve ilk 4 KPI tile (günlük ciro / sipariş sayısı / ortalama adisyon / iptal sayısı) eklendi. 6 PR (#139-#144).

**PageHeader tutarlılık standardı.** Sayfa başlıklarının tutarsızlığı (Nielsen #4 ihlali) fark edildi; ADR-011 amendment ile PageHeader standardize edildi ve 12 sayfa Pattern A'ya migrate edildi (slot uzantıları: startActions geri navigasyon için, centerActions masa listesi orta aksiyonları için). Paralel bir Claude oturumu aynı brief'i alıp farklı bir amendment tasarladığı için doc-code drift oluştu; recovery PR (#143, amendment-of-amendment + force-push) ile senkron sağlandı. Bu olaydan "tek brief, tek oturum" kuralı kalıcı ders olarak kaydedildi.

- Sprint 14 PR-5a (PR #139): `/raporlar` sayfa iskeleti — Sidebar'da rapor girişi açıldı, RangeFilter + boş durum.
- Sprint 14 PR-5b1 (PR #144): 4 KPI tile canlandı; raporlar ekranında ilk gerçek veri.
- ADR-011 PageHeader amendment + migration (PR #141, #142, #143): 12 sayfa tutarlı başlık düzenine geçti; geri-navigasyon ve orta-aksiyon slot'ları geldi.
- Memory temizliği (PR #140): ADR-002 §10 stale referansları temizlendi.

### Session 58 (2026-05-11) — Raporlar backend %100 + CSV export (Sprint 14 + ADR-021)

**Raporlar backend tamamlandı.** Phase 2 mühürlendikten sonra Sprint 14 backend %100 bitirildi: 13/13 rapor endpoint'i çalışıyor ve hepsi CSV export destekliyor. Yeni endpoint'ler kategori satışları, anomaliler (şimdilik cancel-only), kullanıcı performansı, gün kapanışı (Z) ve anlık özet (snapshot, X). ADR-015 Amendment 1 + ADR-021 (CSV export standardı) Accepted oldu. 11 PR (#127-#137), +141 test.

**CSV export altyapısı.** PII-mask, csv-stream ve csv-format-handler utility'leri ile streaming CSV temeli atıldı. TR Excel uyumu için özel kararlar alındı: ödeme tipi karışımı pipe-separated string (`cash|card`), gün-kapanışı/snapshot alt-dizileri tek-tablo CSV'ye flatten edilmiyor (tek-satır özet header).

**Önemli domain kararı.** `orders` tablosunda `cashier_id` olmadığı netleşti; kasiyer semantiği `payments.created_by_user_id` üzerinden hesaplanıyor (kullanıcı performansı raporu 2 SQL union: garson orders'tan, kasiyer payments'tan). Anomaliler şimdilik cancel-only — ADR-014 comp/void domain emit'i henüz yok; şema 3 tipi destekliyor ama void/comp boş dönüyor (Session 61'de dolduruldu).

- Sprint 14 PR-2a/2b/2c (PR #131-#133): category-sales, anomalies (cancel-only), user-performance endpoint'leri.
- Sprint 14 PR-3 (PR #134): daily-close (Z) + snapshot (X) endpoint'leri + snapshot.
- Sprint 14 PR-4a/4b1/4b2 (PR #135-#137): CSV export foundation (pii-mask + csv-stream + 52 unit test) + 13 endpoint'in tamamına CSV format desteği. PR-4b1'de 3 ardışık CI fix (audit event_type 2-segment regex, FK cleanup zinciri, çift pool.end).
- Sprint 13 Mod B test örtüsü (PR #128): ADR-014 §10 Mod B için 5 case + E2E iskelet.
- ADR + plan işleri (PR #127, #129, #130): Phase 3 sprint seçim audit, ADR-015 Amendment 1 + ADR-021 Draft, Sprint 14 PR-1 atlama kararı (audit yanlış alarmı doğrulandı).

### Session 57 (2026-05-10) — Sprint 9b kapanış + Phase 2 mührü

**Sprint 9b ✅ KAPANDI:** Sprint 9'da ertelenen S2-S5 Playwright smoke senaryoları tamamlandı. ADR-019 §1'deki 5/5 senaryo lock'u (S1+S2+S3+S4+S5) + bonus S6 yeşil. Tek oturumda 4 feature PR. Phase 2 EXIT MÜHRÜ 2026-05-10 atıldı.

**E2E locator olgunluğu:** Multi-item liste sayfalarında global `click` ilk DOM match'ini alıp yanlış kart'a tıkladığı için (S2 → S6 regresyonu, 8 CI iterasyonu sonunda root cause), scope-aware helper'lar + `data-testid` pattern zorunlu kılındı. Radix DropdownMenu için manuel `pointerdown + pointerup + click` dispatch helper'ı eklendi (native click yetersiz).

- Sprint 9b PR-A (PR #121): ADR-019 Amendment 3 (auth pattern — Zustand persist yok, UI login per test kanonik) + `loginViaUI` helper + S5 settings senaryosu.
- Sprint 9b PR-B (PR #122): S2 Salon Bölgeleri CRUD smoke + scope-aware helper'lar + `AreaCard` data-testid (8 CI iterasyon, CI diagnostic ile root cause).
- Sprint 9b PR-C (PR #123): S3 menü kategori CRUD smoke + `openRadixDropdown` + `clickMenuItemByText`; ADR-019 Amendment 4 (kategori CRUD only smoke, ürün/variant Sprint 10+ backlog).
- Sprint 9b PR-D (PR #124): S4 kullanıcı CRUD + login fail smoke (1 CI iter — pattern oturdu).
- 8 yeni E2E helper (`apps/web/e2e/helpers/auth-login.ts`) + `AreaCard`/`CategoryListItem`/`UsersPage` data-testid eklemeleri; SPA içi navigation için `spaNavigate` (page.goto SPA killer bypass).
- Phase 2 exit kriterleri ✅ mühürlendi (PR #126), Session 57 anchor (PR #125).

### Session 56 (2026-05-09) — Sprint 12 KDS UI %100 kapanış (ADR-020)

**Sprint 12 (KDS UI + Kitchen Routing) ✅ %100 KAPANDI:** Mutfak ekranı (KDS) backend + frontend + E2E tam stack tamamlandı. 5 PR. ADR-020 K2/K3/K6/K7/K12 kararları tam implementasyon: kitchen_print kategori filtresi, sent→preparing→ready state machine, 5/10dk eşikleri, kitchen+admin yetki, realtime room.

**Kritik prod fix:** PR-2c'den beri production io wiring kırıktı — `index.ts` sırası yüzünden `deps.io === undefined` ile orders router mount edilmiş, `kitchen.*` emit'leri sessizce no-op oluyordu. Web UI'da `/kds` ekranı, `KdsOrderCard`, realtime hook ve Sidebar Mutfak linki canlandı.

- Sprint 12 PR-2d (PR #115): kds.test.ts 9 integration test + dine_in POST hook + io wiring (`BuildAppOptions.io?`).
- Sprint 12 PR-3a (PR #116): production io wiring fix — `createRealtimeServer` önce, `buildApp(io)` sonra.
- Sprint 12 PR-3b (PR #117): docs/v3-reference/kds-behavior.md (KDS davranış notu).
- Sprint 12 PR-3c (PR #118): Web UI `/kds` + `KdsOrderCard` + `KdsPage` + `useKitchenRealtime` + Sidebar Mutfak linki + i18n.
- Sprint 12 PR-3d (PR #119): Smoke S6 KDS happy path E2E + kitchen seed kullanıcı + rate-limit bypass env.
- Test: apps/api 333→342 (9 yeni KDS integration), e2e 1→2 (S6). HCI: per-item pending state (`pendingItemIds: Set`) ile rush-hour'da sadece tıklanan buton disable. Session 56 anchor (PR #120).

### Session 55 (2026-05-08) — Sprint 9 kapanış (Playwright E2E + S1, ADR-019)

**Sprint 9 ✅ KAPANDI (Phase 2 alt-kriter):** Playwright E2E altyapısı kuruldu + S1 smoke senaryosu yeşil + CI bloklayıcı. ADR-019 (E2E Smoke Suite Stratejisi) Accepted — Chromium-only, worker 1, kysely direct seed, postgres service container reuse. Tek PR #108, 4 zincirli CI fix iterasyonu.

**Sprint 9b'ye erteleme:** qa-engineer S2-S5 spec'lerini lokal UI keşfi olmadan yazdı, locator'lar gerçek DOM ile uyuşmadı (CI 4. koşumda 9/12 fail). Pragmatik karar: Sprint 9 daraltıldı (S1 + altyapı), S2-S5 Sprint 9b'ye ertelendi. ADR-019 §1 Amendment 2 ile ayrım lock'landı; §3.1 amendment lokal `pos_e2e` / CI `pos_dev` DB ayrımı.

- Sprint 9 (PR #108): `apps/web/e2e/` (global-setup, fixtures, helpers, S1 spec, README) + playwright.config.ts (Chromium-only, worker 1) + `.github/workflows/e2e.yml` (postgres:17 service reuse) + vite.config preview.proxy.
- 4 CI fix: workspace packages dist build step, ESM globalSetup string path, vite `preview.proxy` (dev `server.proxy` preview'da çalışmaz), S5 saf scope + kör S2-S5 spec'leri silindi.
- Session 55 anchor (PR #109). Not: (tenant_id, username) UNIQUE borcu (PR #110) bu dönemde sıradaki küçük PR olarak işaretlendi.

### Session 54 (2026-05-07) — Sprint 11 borç temizliği (paket + hard-delete + raporlar)

**Sprint 11 borçları kapatıldı:** 5 Mayıs'ta açılıp 2 gün CI fail durumda kalan PR'lar (migration/schema/fixture drift) toparlandı. 5 PR main'e taşındı, 329/329 test PASS, 0 skip. Açık PR sıfıra indi. Charter Phase 2 exit kriterlerinden REST + Socket.IO + Web UI 4/4 sağlandı (yalnız Sprint 9 Playwright E2E kaldı).

**Migration numara çakışması dersi:** Bug-fix PR #105 (Migration 027/028) açık PR'lardan önce merge edilince numara çakışması yarattı; tüm açık PR'lar manuel rebase + cherry-pick gerektirdi. Squash-onto-main yöntemi 22 commit interactive rebase yerine tercih edildi. `feedback_pr_merge_collision_avoidance` dersi yazıldı.

- Paket sipariş akışı (PR #102): paket (takeaway) sipariş + sidebar fix + müşteri atama + ADR-017/018; DTO `tableId/orderNo/waiterUserId`, GET takeaway authorize'a kitchen eklendi.
- Hard delete + snapshot pattern (PR #103): masa/bölge hard delete + cascade NULL + ADR-009 amendment + ADR-003 §7 snapshot pattern (Migration 030→032 renumber).
- Paid-only raporlar (PR #104): paid-only ciro endpoint'leri (Session 53c Amendment v2 + Amendment 3).
- Migration fix (PR #105): Migration 027 idempotent guard + 028 store_date::SMALLINT cast (gizli POST /orders 500 bug) + vitest fileParallelism + Masa 26 etiket bug.
- Sprint 11 borç kapanışı (PR #106): reports.test 12 testi geri açıldı, Tenant B takeaway PR #102 şemasına uyduruldu, afterAll customers cleanup (FK violation fix), ADR-009 hard-delete amendment decisions.md'ye işlendi.
- Cleanup: 6 geçici worktree git registry'den kaldırıldı, 50+ eski local branch silindi. Session 54 anchor (PR #107).

---

### Session 52 (2026-05-04 cont.) — Paket sipariş akışı (ADR-017 + ADR-018)

**Added:**
- ADR-017 paket sipariş akışı + ADR-018 sipariş ekranı birleştirme (commits `e2475c4`, `d0a236a`)
- Migration 028 — `orders.takeaway_stage` enum + `planned_payment_type` + `delivery_address_snapshot` + `delivery_note` + 2 CHECK constraint + partial index (`5e87947`)
- Migration 029 — `populate_order_store_date` trigger smallint cast fix (production bug, 026'dan beri kırık) (`de6198a`)
- Backend takeaway: POST/GET/PATCH /orders endpoint'leri, repo (`createTakeawayOrder`, `findOrderById`, `listOpenTakeawayOrders`, `updateTakeawayStage`, `cancelTakeawayOrder`), audit whitelist 4 event, Socket.IO emit (`8cfd75c`, `4731f06`)
- 15/15 backend integration test (`apps/api/src/__tests__/orders.takeaway.test.ts`)
- Frontend: `OrderScreenPage` paket+masa unified (orderType discriminator), CustomerPickerModal, PaymentMethodModal, OpenTakeawayOrdersPanel, TakeawayOrderCard (v3 paritesi: gradient bg, sol şerit, 3-nokta menü Yazdır+İptal, status badge) (`d92e220`, `66ef470`, `7c38589`, `83092ef`, `388501f`)
- AdisyonPanel v3-paritesi styling (font/spacing/color) — `1eb2375`
- `created_by_user_id` + `created_by_name` paket items'a yazılır (turuncu chip parite) — `cd10f1f`
- Caller Bridge integration test (PR-8 kalanı)

**Changed:**
- ADR-018 ile sipariş ekranı yeniden birleştirildi: rich `OrderScreenPage` (Phase 2, dine_in) korundu, içine takeaway desteği eklendi (`ee961a5` revert + `7c38589` integrate)
- `payments.idempotency_key` UUID — takeaway için orderId doğrudan key olarak kullanılır

**Yarın (Session 53)** açık WIP iş — `wip(web): partial dine_in customer + back area expansion` commit `e3ad77c`:
- [ ] PATCH /orders/:id/customer endpoint (mevcut siparişe müşteri ata) — backend yazılmadı
- [ ] OrderScreenPage'de mevcut sipariş için customer assign mutation (`useAssignCustomer` hook eksik)
- [ ] Geri butonu — başlık + altyazı arasındaki tüm boş alan tıklanabilir olmalı (kısmen yapıldı, doğrulama gerek)
- [ ] Sidebar header layout fix — turuncu logo sızıntısı + "Restoran POS" yerleşim + X close hizalama
- [ ] `t('order.customer.assignOnlyOnNew')` ham toast key — kaldırılacak (yerine PATCH ile gerçek atama)
- [ ] OrderScreenPage default kategori — "Tümü" yerine ilk kategori (kısmen yapıldı, doğrulama gerek)
- [ ] PR açma + merge: `feat/takeaway-flow` → `main` (PR #102 hedef)

### Session 51 (2026-05-04) — PR-8 Caller ID + Müşteri Yönetimi (ADR-016)

**Added:**
- Migration 027 — customers/customer_addresses/call_logs şeması + tenant_settings caller_id_* (PR-8a, commit `ba9228f`)
- 13 customer + caller-id endpoint (PR-8b, commits `263bf2c`/`6bd80c0`/`828bfd7`) — bridge auth, Socket.IO room, bypass pattern
- Web: `IncomingCallProvider` + popup, `CustomersPage`/`CustomerDetailPage`, Excel import/export, kara liste, toplu sil (PR-8c, commits `08dfbcd`..`181d8f8`)
- TTL cleanup cron — `audit_logs` 2y + `call_logs` 30d KVKK retention (PR-8e, commit `6a49204`); `apps/api/src/cron/ttl-cleanup.ts`, advisory lock registry, self-audit `audit.purge` event
- Caller Bridge .NET 8 Worker Service (PR-8d, PR #100) — `apps/caller-bridge/`, cid.dll P/Invoke, `X-Bridge-Token`, KVKK phone masking
- `phoneInvalid` + `nameNoLetter` inline validation NewCustomerDrawer (commit `fc42c11`)

**Changed:**
- `customers.drawer.phonePlaceholder` realistic number → `0123456789` (commit `cfa8315`)
- POST/GET/PATCH `/customers/:id` response shape flatten (`{data:x}`) — frontend hook uyumu

**v5.1 backlog'a ertelendi:**
- PR-8f V3 müşteri import CLI (ImportDrawer UI yeterli)
- Multi-line CIDShow (4/8 port), arama geçmişi raporu, sadakat puanı, kampanya SMS

**DoD borç kapatması (Session 51 ikinci yarı):**
- ADR-016 §Karar 9 backend integration testleri + frontend RTL
- HCI critical/major bulguları (telefon/adres silme onaysız, popup buton 32→48px, hover-only state, kırmızı seçili state semantik)
- Turkish UX bulguları (CSV header hardcode, 'Ev' i18n)
- CHANGELOG `[Unreleased]` (bu girdi)

### Session 25 (2026-04-25..26) — Phase 1.5 paketi + ADR-004 Accepted

Phase 1 Exit Audit (Forensic Verdict B): charter "Menu/Payment/User policy'leri" maddesi sessiz daraltma + Katman 2 ek bulgular (ESLint, migration idempotency, ölü directives). Phase 2 öncesi 9 iş paketi.

**Added:**
- ADR-004 Accepted — Print Agent Mimarisi (Phase 2 başı, commit `8fb7e1b`)
- `packages/shared-types/src/permissions.ts` — ADR-002 §6 role permission matrix, default-deny, ABAC notu (commit `bc9cba1`)
- `packages/shared-domain/src/menu.ts` Menu policy + 5 test — `canHardDeleteProduct` (ADR-003 §8 + Sinyal #7) (commit `bf33fc5`)
- `packages/shared-domain/src/payment.ts` Payment policy + 20 test — `canAddItemToPayment`, `calculatePayableCents`, `canCloseOrder`, `validateCashTendered` (ADR-003 §10) (commit `c27de1a`)
- `packages/shared-domain/src/user.ts` User policy + 20 test — `validatePassword`, `canManageUsers`, `canHardDeleteUser` (ADR-002 §1/§6/§8 + ADR-003 §8) (commit `a564d55`)
- ESLint `no-restricted-imports` kuralı + gerçek `lint`/`lint:fix` scriptleri (ADR-001 §2.2) (commit `040521f`)

**Changed:**
- Migration scriptleri `CREATE ROLE` → `DO/EXCEPTION` idempotent pattern (cluster-level çakışma fix) (commit `3eb8481`)
- `docs/v3-reference/domain-rules.md` + ADR-003 §10 prose: `payment_scope` enum isimleri RENAME sonrası güncellendi (`full_order/split_item/equal_split` → `full/item/partial`), `payment_type` += `transfer`, ADR-003 §10.2.3 `OrderCompService` dosya yolu (`shared-domain/orderComp.ts` → `apps/api/services/orderComp.ts`, Phase 2'de yazılacak) (commit `2526aa7`)
- `packages/shared-types/src/user.ts` `UserCreateSchema.password.min(8)` → `min(10)` (ADR-002 §8 hizalaması) (commit `27a6484`)
- `apps/api` ölü `eslint-disable` directives temizliği (ADR-001 §2.2 enforce sonrası yan ürün) (commit `3c5458b`)

**Açık borç (yeni):**
- decisions.md §9 `CREATE TYPE payment_scope AS ENUM ('full_order', 'split_item', 'equal_split')` hâlâ eski isimleri kullanıyor — ayrı drift ticket
- Demo seed şifresi `admin1234` (9 char) ADR-002 §8 ihlal — `local-dev.md` smoke curl güncellemesi dahil ayrı ticket (anchor borçlar listesinde, commit `b5a0277`)

**Next:** Phase 2 (Sipariş + Masa + Menü UI). Öncesi: GitHub Pro upgrade + branch protection main'de aktif.

**Session commits:** `bc9cba1`, `040521f`, `3c5458b`, `3eb8481`, `bf33fc5`, `c27de1a`, `66c50b9`, `8fb7e1b`, `2526aa7`, `a564d55`, `27a6484`, `b5a0277`

### Session 22-24 (2026-04-25) — Phase 1 Core Domain + Auth + DB Repository ✅

Görev 9-13 (shared-types, shared-domain pure, packages/db repository, apps/api auth, seed + smoke) tamamlandı; Phase 1 exit ✅, CI yeşil.

**Added:**
- `packages/shared-types` zod şemaları — auth/user/table/menu/order/payment/audit/money (Görev 9, commit `43bf030` + DoD fix `c65334e`)
- `packages/shared-domain` pure domain fonksiyonları (money/order/tax/table/order-no/validation) + 75 test + Vitest setup (Görev 10, commit `7f7b28c`)
- `packages/db` connection + repository katmanı: `connection.ts`, `kysely.ts`, `repositories/{users,refresh-tokens,tables}.ts`, `errors.ts` (`RepositoryError`/`NotFoundError`/`ConflictError`/`mapPgError`) (Görev 11, commit `c6c80e8`)
- Migration 002 (`refresh_tokens` tablosu, BYTEA SHA-256 hash) + 003 (`users.email` kolonu) — kysely-codegen aligned
- `apps/api` auth modülü: `jwt.ts` (HS256 30m), `password.ts` (bcrypt 12), `refresh.ts` (RTR + reuse detection + transaction), `cookie.ts` (HttpOnly/Secure/SameSite=Strict/Path=/auth/refresh), `middleware/{authenticate,authorize}.ts`, `routes/auth.ts` (login + refresh + logout + me, rate limit 5/15m/IP, CSRF header) (Görev 12, commit `7180503` + `e3c4a7f`)
- `packages/db/src/seed.ts` — idempotent dev seed (1 tenant Demo Restoran, 1 admin user `admin@local.test`/`admin1234`, 5 masa MASA 1..5, 3 kategori, 5 ürün), `NODE_ENV=production`+`ALLOW_SEED!==true` guard (Görev 13)
- `docs/engineering/local-dev.md` — yerel geliştirme akışı + 6 adım curl smoke senaryosu
- ADR-004 Draft — Print Agent Mimarisi (Phase 2 başı), `architect` sub-agent ile yazıldı, 8 açık soru ile kapatıldı (Session 24, commit `e2c967d`)

**Changed:**
- Security blocker fixes (apps/api): DUMMY_HASH constant timing defense, `/health` error mesajı sabit, 500 handler `console.error` (commit `e3c4a7f`)
- bcryptjs ESM/CJS interop (`/index.js`), pool çift-close, `packages/db` exports, `apps/api` `"type":"module"`, `apps/api/.env.example` TENANT_ID UUID v7 hizalandı, `000_init.sql` hardcoded "Pilot Restoran" INSERT kaldırıldı (migration=şema, seed=veri ayrımı)
- `tables.code` 'MASA 1'..'MASA 5' (kullanıcı konvansiyonu) (commit `79a06e1`)

**Açık borç:**
- `tables.status` derived field semantiği — Phase 2 sipariş ekranı öncesi ADR-003 §14.2.B ile hizalama
- Migration 003 partial index — Phase 3'te `email NOT NULL` sonrası `WHERE email IS NOT NULL` partial olarak yenilenecek

**Next:** Phase 1.5 paketi (eksik policy + drift cleanup) — Phase 2 öncesi forensic audit bulgularını kapat.

**Smoke 6/6 yeşil:** login (200) → me (200, tenantId UUID v7) → refresh (200, token rotated) → me (200) → logout (200) → refresh-after-logout (401 `AUTH_REFRESH_INVALID`). CI workflow + Migration Check ✅ (run 24938360853, 24938360868).

**Session commits:** `1292b7f`, `7efe422`, `43bf030`, `24a37ea`, `7f7b28c`, `a81c040`, `c65334e`, `b1d596b`, `c6c80e8`, `4f48e66`, `0efeea7`, `73805be`, `7180503`, `8cb8b70`, `036ad36`, `e3c4a7f`, `a4aa467`, `ef8f2db`, `79a06e1`, `6d181e6`, `e2c967d`, `f0fd920`

### Session 11-21 (2026-04-22..25) — Phase 0 finalization ✅

ADR-003 §10-§16 tam Accepted, ADR-001/ADR-002 Accepted, monorepo bootstrap + docker + hello endpoint. Phase 0 exit ✅.

**Added:**
- ADR-003 Bölüm 10 (Ödeme Modeli & İnvaryantları) — §10.1-10.4 onaylandı (commit `15649bb`), §10.5 review gate + §6.5 composite UNIQUE (`caa0b53`), mini-pass C1-C4 concerns (`459ea97`)
- ADR-003 Bölüm 11 (order_no Günlük Unique sayaç) + mini-pass A1-A3 (commit `9fd6467` + `2938b0f`)
- ADR-003 Bölüm 12 (`audit_logs` + AuditSanitizer<T> kontratı) (commit `8abd722`)
- ADR-003 Bölüm 13 (Retention + cron + RLS) + 2x mini-pass (commit `df08a18`)
- ADR-003 Bölüm 14 (Kritik index'ler) + ikili review + mini-pass A1-A6 (commit `eddf6f7`)
- ADR-003 Bölüm 15 (Migration Stratejisi) + paralel review + mini-pass A1-A7 (commit `a8d00f2`)
- ADR-003 Bölüm 16 (Consequences) + ADR-003 Accepted (commit `c3c0cb7`)
- `packages/db/migrations/000_init.sql` — initial schema (14 tablo, 7 enum, 4 DB rolü) (commit `5d7d08d`)
- ADR-001 Accepted — monorepo structure + package naming + CI/deploy pipeline (commit `308f08a`)
- ADR-002 Accepted — auth strategy, JWT/RTR, role matrix (commit `49682c6`)
- Monorepo iskelet + CI pipeline (Görev 6, commit `98f4563`)
- docker-compose lokal PostgreSQL + kysely-codegen (Görev 7, commit `6fb7299`)
- Hello endpoint — `GET /health` + web ana sayfa (Görev 8, commit `043e225`)
- `docs/context-anchor.md` — Claude.ai sohbetleri için tutarlılık çapası (commit `0f31fce`)

**Changed:**
- Session kapanış protokolüne context-anchor §2 güncelleme adımı eklendi (commit `a95fdef`)
- `apps/web` `"type":"module"` (postcss ESM warning sustur, commit `f6a26dd`)

**Açık borç (Phase 0 sonu):**
- Daily-closeout ADR (§10.4.2 forward-ref)
- Error taxonomy ADR (§10.5 C6 + §11.10)
- PITR/backup stratejisi (`docs/ops/backup-strategy.md`)
- Cron lock id registry (`docs/engineering/cron-conventions.md`)
- KVKK veri haritası (`docs/compliance/kvkk-data-mapping.md`)
- §11 parity stress harness, §14.5/§14.6 ölçüm borçları

**Next:** Phase 1 (Core Domain + Auth + DB Repository) — Görev 9-13.

**Session commits (özet):** `c705f13`, `15649bb`, `caa0b53`, `459ea97`, `9fd6467`, `2938b0f`, `8c44ff9`, `8abd722`, `df08a18`, `eddf6f7`, `4091fa0`, `a8d00f2`, `c3c0cb7`, `5d7d08d`, `d954caa`, `308f08a`, `49682c6`, `21634f3`, `98f4563`, `6fb7299`, `42d8c8d`, `043e225`, `7fa5869`, `f6a26dd`, `0f31fce`, `a95fdef`

### Session 10 (2026-04-24) — ADR-003 Bölüm 7-9 onaylandı

**Added:**
- ADR-003 Bölüm 7 (Snapshot İnvaryantı) — verbatim onay, Edit kilit
- ADR-003 Bölüm 8 (Soft vs Hard Delete) — verbatim onay, §8.4 ON DELETE RESTRICT gerekçesi + §8.5 default filter kuralı (tool-agnostik repository helper) eklendi
- ADR-003 Bölüm 9 (Enum Kullanımı) — verbatim onay, §9.1 enum listesi final (7 enum), §9.2.1 4 domain kararı (delivery, equal_split, payment_type değişmedi, print_job_status.cancelled), §9.3 forward-only 4 kural (ADD/REMOVE/REORDER/RENAME), §9.5 review gate (a/b/c)
- `CLAUDE.md` Core Directive #7 "Cerrahi değişiklik" (Karpathy CLAUDE.md §3 adapt)
- `docs/context-anchor.md` (yeni Claude.ai sohbetleri için yapıştırılabilir tutarlılık çapası)

**Changed:**
- ADR-003 §9.3 ADD VALUE örneği `order_status 'delivered'` → `order_type 'catering'` (delivery enum kararı sonrası tutarlılık)
- ADR-003 §9.5(b) db-migration-guard referansı somutlaştı (`.claude/agents/db-migration-guard.md` atıf + pre-commit hook ADR-001 bağı)
- ADR-003 §9.2.1 `order_type.delivery` maddesine v3→v5 geçiş notu eklendi

**Açık borç (yeni):**
- v3→v5 takeaway/delivery backfill ADR'si — Phase 5 geçiş planında yazılacak; `active-plan.md` Follow-up'ta kayıtlı

**Next:** ADR-003 Bölüm 10 (Ödeme Modeli & İnvaryantları) — Session 11

**Session commits:** `4289bde`, `0f31fce`, + Bölüm 9 onay commit'i (bu session)

### Session 8 (2026-04-22) — Görev 1 kapandı, ADR-003 sırada

**Added:**
- Charter v5.0 kapsam onaylandı (Phase 0 Görev #1 ✅, commit `72e00c5`)
- `docs/project-charter.md` → "Kapsam değişikliği nasıl belgelenir" paragrafı — erteleme / mimari / tasarım ADR ayrımı kuralı
- `docs/domain/personas.md` → terminoloji notu: yasal Z raporu (yazarkasa) vs POS günlük kapanışı ayrımı

**Changed:**
- Phase 3 roadmap ↔ MVP listesi tutarsızlıkları giderildi (iskonto v5.1'e ertelendi, raporlar MVP ile tam uyumlu)
- Personas.md "Z raporu" → "günlük kapanış raporu (POS)" (2 satır)
- İskonto placeholder'ları: `ADR-XXX` → `commit a6d746e` (erteleme kapsam kararı, tasarım ADR'si v5.1'de)
- `active-plan.md` Görev 1 ✅, ADR sırası netleştirildi (ADR-003 → ADR-001 → ADR-002)
- `scratchpad.md` Session 8 kapanış + Session 9 starter prompt eklendi

**Next:** ADR-003 DB Şema İlkeleri (Session 9) — `architect` + `db-migration-guard`

**Session commits:** `72e00c5`, `cdb3deb`

### Session 1 (2026-04-22)

**Added:**
- v3 reference infrastructure: `docs/v3-reference/modules.md` (Modül 1 Ayarlar + Modül 2 Auth/Login tam dolu, 15 modüllük sıra belirlendi)
- `CLAUDE.md` → yeni "v3 referans erişimi" bölümü (read-only, copy-paste yasak, kaynak etiketleme kuralları: Kodda tespit / Kullanıcı gözlemi / Doğrulanmamış)
- `.claude/skills/simple-first-ui/SKILL.md` — iskelet (detay Phase 0 sonunda dolacak)

**Changed:**
- `docs/hci/pos-checklist.md` — yeni "Basit UI & Sıfır Yapılandırma" bölümü (iki seviye ayarlar gate + zero-config gate + v3 Yazıcı Detayı anti-örneği)
- `CLAUDE.md` — v3 yol tutarlılığı (`d:/dev/restoran-pos-v3/` → `D:\dev\restoran-pos-v3\`)
- `.claude/plans/active-plan.md` — ADR İzleme bölümü (ADR-004 Print Agent Phase 1 notu), Session 2 açılış görevi, Görev 2 ilerleme durumu (2/15 modül)
- `.claude/memory/scratchpad.md` — ADR-002 açık kararlar + Session 1 kapanış özeti + v3 mimari sinyaller + Session 2 starter prompt

**Architectural signals (v3 kod araştırması sonrası):**
- Garson rolü v3'te yalnız `/tables` route — sipariş yönetimi masa detayı içinde entegre (v5 Modül 4 tasarımına sinyal)
- Rol matrisi v3'te tek merkezi yerde (`tD` nav array) — v5'te korunacak config-driven yaklaşım
- Backend route guard varlığı doğrulanamadı — v5'te kesinlik (her endpoint'te rol kontrolü), `pain-points.md` adayı
- Şifre reset v3'te admin-manuel-reset modeli kodlanmış — hibrit ADR-002 önerimizle uyumlu

**Session commits:** `b4d308b`, `25e395f`, `259b102`, `e2a86fb`

### Added
- Phase 0 bootstrap paketi (CLAUDE.md, sub-agent'lar, skill'ler, engineering docs)
- v4'ten taşınan altyapı: architect/implementer/qa/security/hci/turkish-ux/db-migration-guard sub-agent'ları
- v4'ten taşınan skill'ler: escpos-printer, caller-id-bridge, hci-pos-checklist, turkish-restaurant-domain, multi-tenant-postgres (MVP tek tenant notuyla), react-native-expo-setup, hetzner-deployment
- Engineering docs: code-style, definition-of-done, git-workflow, test-strategy
- Slash command'lar: `/new-adr`, `/phase-done`
- Hook'lar: ADR hatırlatması, commit format kontrolü, oturum açılış notu
- `docs/domain/personas.md` — 4 rol (admin, kasiyer, garson, mutfak) + yetki matrisi
- `docs/project-charter.md` — v5.0 MVP / v5.1 / v5.2+ / non-goals ayrımı
- Phase roadmap (5 phase, 23 hafta ≈ 5.5 ay)

### Changed
- **Kapsam revizyonu** (charter v2): v3'ün gerçek modül kapsamına göre charter yeniden yazıldı
- MVP dondurulmuş özellik listesi: auth + masa + menü + sipariş + mutfak + ödeme + Caller ID + Print Agent + temel raporlar + web + mobile + audit/yedek backend
- v5.1'e ertelendi: detaylı raporlar, stok, rezervasyon, müşteri CRM, audit/yedek/sürüm notları/mobil eşleştirme UI'leri
- Kalıcı non-goal olarak işaretlendi: çoklu şube (v5.2'de değerlendirilir), e-Fatura, yazarkasa, yemek platformları, QR menü, sadakat, combo
- StoreBridge → v5'te Print Agent olarak yeniden adlandırıldı (aynı iş, temiz mimari)
- Proje özeti: "30 masalı" → "25 masalı pide/lokanta" (v3 ekranlarından doğrulandı)

### Removed
- v4'ten: Electron bağımlılığı (desktop app → web UI)
- v4'ten: Lokal SQLite (cloud PostgreSQL tek DB)
- v4'ten: CRDT/sync engine ve ilgili skill'ler (`better-sqlite3-electron`, `sync-crdt-patterns`)
- v4'ten: electron-specialist, sync-engine-specialist sub-agent'ları
- v4'ten: 22+ v4 ADR'si (v5 kendi kararlarını yazacak)
- v4'ten: 5 journey, 5 persona, event-storming dokümanları (MVP kapsamına uygun değil)
- v4'ten: `sync-schemas` slash command'ı (tek DB, sync yok)

### Timeline
- 2026-04-22: İlk charter (kapsam yanlış, çok dar)
- 2026-04-22: Charter v2 — v3 ekran görüntüleri incelendi, kapsam v3 seviyesine güncellendi, MVP/v5.1 ayrımı yapıldı
- 2026-04-22: Session 1 — Modül 1 Ayarlar ve Modül 2 Auth/Login röportajları tamamlandı, v3 kodu araştırması ilk kez yapıldı, stratejik kararlar (yazıcı sıfırdan + basit UI prensibi) kaydedildi
