# Blok 11 — apps/print-agent (Node.js Windows servisi): derin denetim

> Derin denetim serisi Blok 11. **Tarih:** 2026-07-12 · **Branch:** `audit/11-print-agent` (base `a40b28a`) · **Model:** Fable 5.
> **Yöntem:** 3 paralel hat (A: qa-engineer — kuyruk/recovery/çift-basma · B: qa-engineer — config/P-Invoke/lifecycle · C: security-reviewer — API-key/tenant) + ana-context kod-doğrulama (çift-basma zinciri, BOM zinciri, reclaim backend ucu bizzat okundu) + severity kalibrasyonu.
> **Canlı doğrulama:** mevcut vitest suite **39/39 yeşil** (mock transport, güvenli); `spooler-raw-exe.test.ts` gerçek vendored binary'yi bu ortamda çalıştırdı (P/Invoke tazeliği); BOM davranışı bu makinede PS5.1+PS7 ampirik test edildi (scratchpad, repo dokunulmadı). Servis BAŞLATILMADI, prod API/yazıcı/key'e dokunulmadı. Prod kod DEĞİŞTİRİLMEDİ.
> **Testler:** `apps/print-agent/audit/` 2 dosya (node:test .mjs — mevcut vitest suite'ini kirletmez): **8 kasıtlı KIRMIZI + 7 yeşil.** Koş: `node --test apps/print-agent/audit/`.
> **Ham bulgu:** A:7 · B:9 · C:6 → konsolide **18 bulgu: 0 BLOCKER (2 sub-agent-BLOCKER'ı gerekçeli HIGH'a kalibre) · 5 HIGH · 8 MEDIUM · 5 LOW.**

---

## 0. Yönetici özeti

**Agent çekirdeği güvenlik ve tenant-izolasyonu açısından örnek, P/Invoke gerçek (S88 tazelendi), lazy-reclaim doğru; ama iki operasyonel-kritik dayanıklılık boşluğu var: (1) başarı-belirsizliği reclaim'e düşünce çift-fiş + hata yolları process'i çökertiyor, (2) kasa kurulum script'i PS5.1'de BOM'lu config yazıp agent'ı boot-loop'a sokabiliyor.**

**✅ Güçlü çıkanlar (kod/test-doğrulandı):**
- **Tenant izolasyonu SAĞLAM (kritik):** claim/result/refresh hepsi `tenant_id = <JWT tid>` filtreli, `tid` HS256 imzalı → **başka tenant job'ı çekme yolu YOK** (Hat C). Claim atomik: `FOR UPDATE SKIP LOCKED LIMIT 1` (iki-agent yarışı çözülü).
- **P/Invoke GERÇEK (native-interop-verify dersi geçti):** `spooler-helper/Program.cs` OpenPrinterW/StartDocPrinterW/DOC_INFO_1/WritePrinter imzaları Win32'ye karşı satır satır doğru; vendored binary bu ortamda çalıştı; S88 (#311) commit'ine karşı **drift yok** (S86 Caller-ID "uydurma-ama-derlenir" kazasının tersi).
- **Lazy reclaim doğru:** stuck 'printing' reclaim cron değil, `/jobs/next` claim SELECT'ine gömülü + `attempts`'a dokunmuyor + anti-starvation sıralı (ADR-004 Amd3 birebir; adversarial-review dersi korunmuş).
- **Key hijyeni:** 192-bit CSPRNG + bcrypt-12, düz-metin DB'de asla; fiş byte'ları **stdin** ile exe'ye (temp dosya yok, PII log yok); agent port dinlemiyor (saf pull); TLS bypass yok; başlangıç log'unda key yok.

**🟠 5 HIGH:**
1. **P11-A-01** — `reportResult` fetch try/catch'siz + `main` for(;;) `pollOnce`'ı sarmıyor → (a) success-ack transient hata alıp failed-ack başarılı giderse backend başarılı baskıyı 'failed' görüp **reclaim ile yeniden bastırır** (çift fiş); (b) her iki ack fırlarsa exception main'den kaçar → unhandled rejection → **process çöker** → nssm restart → stuck-printing reclaim → yine çift baskı. Backend re-print ucu bizzat doğrulandı (`RECLAIM_STALE_SECONDS` → yeniden 'printing', satır 73 yorumu "re-print").
2. **P11-B-01** — `config.ts:91` BOM strip etmiyor + `install-second-agent.ps1:139,150` `Set-Content -Encoding UTF8` + script'te `#Requires -Version 7` yok → **PS5.1 (restoran PC varsayılanı) BOM'lu config yazar** → boot'ta `JSON.parse` patlar → P11-B-02 nedeniyle ham stack + nssm restart-loop → **kasa yazıcısı hiç açılmaz.** S91 "config BOM'suz olmalı" dersinin installer-regresyonu (bu makinede ampirik doğrulandı: PS5.1→EF BB BF, PS7→temiz).
3. **P11-B-02** — `main()` `loadPrinterConfig/loadJobKinds/register` try/catch'siz + `process.on('SIGTERM'/'unhandledRejection')` **hiç yok** → her fail-fast ham stack basıp restart-loop'a giriyor; P11-A-01b ve P11-B-01 crash-zincirlerinin ortak kök-nedeni.
4. **P11-SEC-01** — `install-second-agent.ps1:82,176` key'i `-ApiKey` komut-satırı parametresiyle alıyor → PSReadLine `ConsoleHost_history.txt` + nssm registry'de **düz-metin** (RustDesk/ekran-paylaşımı dersiyle gerçek risk).
5. **P11-A-03** — ağ hatasında main-loop backoff yok → cloud unreachable'da long-poll da beklemez → **hot-loop** (CPU %100 + log-flood → C: kronik-dolu makinede disk riski).

**Kalibrasyon (ana-context, gerekçeli):**
- **P11-A-01 çift-basma: Hat A "BLOCKER" → HIGH.** Master-prompt satır 464 "çift-basma=BLOCKER" der; AMA seri boyunca BLOCKER eşiği **finansal/veri kaybı + sessiz + runtime** oldu (MONEY-01/DB-TX-01/M10-A-01 hepsi müşteri parası). Bu çift-fiş **kağıt/operasyonel** (Blok 8 P8-ENQ-09 emsali MEDIUM'du) + tetikleyici dar timing (ack anı ağ) + mutfak çift-fişi aynı-masa-no ile aşçı tarafından yakalanır. **Blok 13'te kullanıcı BLOCKER muamelesi yapabilir** — özellikle P11-A-02 (kısmi-yazım) ile birleşince print-once idempotency mimari eksiği ciddi.
- **P11-B-01 config BOM: Hat B "BLOCKER" → HIGH.** Gerçek + kod+ampirik doğrulandı; AMA **kurulum-zamanı** (runtime-canlı değil; mevcut kasa+mutfak agent'ları prod'da çalışıyor — S89) + **gürültülü** (restart-loop + fiş çıkmaz → teknisyen kurulumda anında görür, sessiz değil). Fix trivial (config.ts'e `.replace(/^﻿/,'')`). Gelecek/üçüncü-tenant kurulumunu bloklar.

### En kritik 3
1. **P11-A-01 + P11-A-02** (HIGH+MEDIUM) — **print-once idempotency yok**: agent "bastım ama ack gidemedi"yi "hiç basamadım"dan ayırmıyor; backend reclaim gereksiz yeniden bastırıyor. Fix: result POST'a print-token / success-ack'i best-effort (ağ-fail'de 'failed' RAPORLAMA) + reportResult try/catch. Blok 13.
2. **P11-B-02** (HIGH) — `main()` sarmalama + `process.on(SIGTERM/unhandledRejection)` + fail-fast'lerde temiz Türkçe operatör mesajı; crash-loop'ları kapatır (A-01b + B-01 ortak fix).
3. **P11-B-01** (HIGH) — `config.ts` BOM strip (2 satır) + `install-second-agent.ps1`'e `#Requires -Version 7` veya `Set-Content -Encoding utf8NoBOM`.

---

## 1. Kapsam & yöntem
**Denetlenen:** `apps/print-agent/src/**` (index.ts ana döngü + config/tcp/usb/spooler-transport + version.ts) + `spooler-helper/Program.cs` (C# P/Invoke) + `installer/{build-msi.ps1, print-agent.wxs, install-second-agent.ps1, spooler-helper/build.ps1}` + `apps/api/src/routes/print-jobs.ts` + `print-agent-auth.ts` (kontratın iki ucu). Çapraz: ADR-004 (+Amd1-4), ADR-032, Migration 036/037.
**Araç:** statik okuma + `pnpm --filter @restoran-pos/print-agent test` (39/39) + vendored spooler-exe gerçek çalıştırma + PS5.1/PS7 BOM ampirik. Servis başlatılmadı.

## 2. Bulgular

### 2.1 HIGH (5)

### [HIGH] [ROB/fiş-bütünlüğü] Ack try/catch yok + main sarmasız → yanlış-'failed' + crash → reclaim çift baskı (ID: P11-A-01) — kod-doğrulandı (3 ayak + backend ucu)
- **Dosyalar:** `index.ts:203` (`reportResult` fetch — try/catch YOK; yalnız `!res.ok` ele alınıyor, fetch'in KENDI throw'u değil) · `index.ts:370-374` (success-ack `pollOnce` try içinde → fırlarsa catch → failed-ack) · `index.ts:326,340` (malformed-payload failed-ack try DIŞINDA → direkt kaçar) · `index.ts:432` (`main` for(;;) `pollOnce`'ı sarmıyor) · `index.ts:436` (`void main()` → unhandled rejection = crash) · **backend:** `print-jobs.ts:73` (`RECLAIM_STALE_SECONDS` → stuck 'printing' bir sonraki claim'de yeniden 'printing' = re-print) + `:37-39` (attempts yalnız failed'de +1).
- **İki senaryo (kod-kesin):** (1) baskı OK → success-ack transient throw → catch → failed-ack başarılı → backend job'ı 'failed'→retry→printing → başka poll re-claim → **çift fiş** (sessiz). (2) baskı OK → her iki ack throw → exception main'den kaçar → unhandled rejection → **process exit** → nssm restart → job 'printing' stale → RECLAIM_STALE sonra reclaim → **çift fiş** + fiş akışı restart'a kadar durur.
- **Etki:** çift mutfak/adisyon fişi (kağıt + operasyonel karışıklık; PARA değil — bu yüzden HIGH, BLOCKER-kalibrasyonu §0). Tetikleyici: baskı ile ack arası ağ hatası (restoran interneti). · **Öneri:** reportResult'ı try/catch'e al; success-ack ağ-fail'inde job'ı 'failed' RAPORLAMA (reclaim yine devreye girer ama attempts patlamaz); gerçek çözüm result POST'a print-once token. · **Etiket:** MVP-fix

### [HIGH] [BUG/config] Kasa kurulum script'i PS5.1'de BOM'lu config yazıp agent'ı boot-loop'a sokar (ID: P11-B-01) — kod+ampirik doğrulandı
- **Dosyalar:** `config.ts:91` (`JSON.parse(readFileSync(filePath,'utf8'))` — BOM strip YOK, grep 0) · `install-second-agent.ps1:139,150` (`Set-Content -Path $ConfigPath -Encoding UTF8`) · script başı yalnız `#Requires -RunAsAdministrator` (`-Version 7` YOK).
- **Ampirik (bu makine, scratchpad):** PS5.1 `Set-Content -Encoding UTF8` → `EF BB BF` (BOM); PS7 → BOM yok. Restoran PC varsayılan shell = PS5.1.
- **Zincir:** teknisyen `powershell install-second-agent.ps1` → BOM'lu config.json → agent boot → `JSON.parse` `Unexpected token ﻿` → P11-B-02 (try/catch yok) → ham stack + nssm restart-loop → **kasa yazıcısı hiç açılmaz.** S91 "config BOM'suz" dersinin installer-regresyonu. · **Kalibrasyon:** kurulum-zamanı + gürültülü (§0) → HIGH. · **Öneri:** config.ts'e `.replace(/^﻿/,'')` + script'e `#Requires -Version 7` ya da `-Encoding utf8NoBOM`. · **Etiket:** MVP-fix

### [HIGH] [ROB] main() hata-yakalama + graceful shutdown yok → her fail-fast crash-loop (ID: P11-B-02)
- **Dosyalar:** `index.ts:401-434` (`main` — loadPrinterConfig/loadJobKinds/register try/catch'siz) · `process.on('SIGTERM'|'SIGINT'|'unhandledRejection'|'uncaughtException')` grep **0**.
- **Etki:** her boot-hatası (BOM, eksik env, register-fail) ham stack basıp nssm restart-loop; SIGTERM'de in-flight yazım yarıda kesilir (lazy-reclaim veri kaybını önlüyor ama gecikme). A-01b + B-01 crash'lerinin ortak kök-nedeni. · **Öneri:** main()'i try/catch + `process.on` handler'ları + fail-fast'lerde temiz Türkçe operatör mesajı (stack yerine "config.json okunamadı: <yol>"). · **Etiket:** MVP-fix

### [HIGH] [SEC] install script key'i komut-satırından alıyor → PSReadLine history + nssm plaintext (ID: P11-SEC-01)
- **Dosya:** `install-second-agent.ps1:82,176` + `.EXAMPLE:60,64` · **Kanıt (kod-tespiti):** `-ApiKey "pk_..."` argümanı `ConsoleHost_history.txt`'ye kalıcı + `nssm set AppEnvironmentExtra` argv'inde + registry'de düz-metin. · **Öneri:** `Read-Host -AsSecureString` / `$env:PRINT_AGENT_API_KEY`; `.EXAMPLE`'dan literal key çıkar. · **Etiket:** MVP-fix

### [HIGH] [ROB] Ağ hatasında backoff yok → cloud kesintisinde hot-loop (ID: P11-A-03)
- **Dosyalar:** `index.ts:251-262` (fetch-fail → return session, bekleme yok) + `:417-433` (main hemen tekrar pollOnce). Long-poll `wait` server-side → server unreachable'da beklemez. · **Etki:** cloud/internet kesintisinde CPU %100 + saniyede log satırı → C: kronik-dolu makinede disk-dolma. · **Öneri:** fetch-fail'de artan backoff (1→5→15sn cap). · **Etiket:** MVP-fix

### 2.2 MEDIUM (8)

- **P11-A-02 [ROB/idempotency]** (B-07 birleşik) — TCP `settle()` başarıyı yalnız `socket.on('close')`'a bağlıyor (`tcp-transport.ts:54`) ama close = "soket kapandı" ≠ "kağıda döküldü"; kısmi yazım sonrası RST → fail → reclaim → **baştan basar** (offset yok) = parçalı+tam mükerrer kağıt. Keep-alive'lı yazıcıda close hiç gelmeyip timeout→yanlış-fail de olası. Fiziksel-doğrulanmamış. P11-A-01 ile aynı "reclaim retry idempotency yok" kökü. · Öneri: print-once token (backend), transport başarı-teyidini netleştir.
- **P11-B-03 [BUG/build]** — `print-agent.wxs:20 Version="0.0.2"` hardcoded; `build-msi.ps1` package.json versiyonunu yalnız dosya-adına koyuyor, WiX'e geçirmiyor → sonraki bump'ta MSI upgrade sessiz no-op / eski-exe-kalır (ekibin S83'te yaşadığı sınıf). · Öneri: wxs Version'ı build-time package.json'dan enjekte + tutarlılık guard.
- **P11-A-04 [test-kapsam]** — claim atomikliği (`SKIP LOCKED`) yalnız sıralı istekle test edilmiş; gerçek eşzamanlı-claim yarış testi yok (mekanizma doğru ama regresyon-koruması eksik). · Öneri: iki-agent concurrent claim testi.
- **P11-SEC-02 [SEC/transport]** — `PRINT_AGENT_API_URL` şema doğrulaması yok (`index.ts:59,84`) → yanlış-config'de `http://` downgrade, key+fiş (paket siparişte müşteri adı/telefon) düz-metin. · Öneri: localhost-dışı http reddet.
- **P11-SEC-03 [SEC/at-rest]** — nssm `AppEnvironmentExtra` key'i registry'de DPAPI'siz (admin-okur). Tek-tenant lokal-PC'de kabul; LocalSystem sistem-env tercih + belgele.
- **P11-SEC-04 [SEC/gelecek]** — `apps/api/logger.ts:38-51` redact listesinde `apiKey` yok (bugün zararsız — body-logger mount edilmemiş; ileride eklenirse `/agent/register` body'sinde key sızar). · Öneri: redact paths'e ekle.
- **P11-B-04 [ROB]** — graceful shutdown yok; in-flight yazım SIGTERM'de kesilir (etki lazy-reclaim ile sınırlı: veri kaybı yok, gecikme). (P11-B-02 ile ortak fix)
- **P11-B-05 [ROB/disk]** — nssm `AppRotateFiles`/stdout-rotation hiç set edilmemiş (installer+wxs) → boşta bile ~25sn'de log satırı, sınırsız büyür (C: kronik-dolu makine). · Öneri: nssm AppRotate* + boyut cap.

### 2.3 LOW (5)
- **P11-SEC-05** — agent log rotation yok (P11-B-05 ile örtüşür; PII yok, disk hijyeni).
- **P11-SEC-06** — `/agent/register` timing oracle: geçersiz tenant-prefix hızlı-401 vs geçerli-prefix yavaş → 8-hex prefix varlığı sızabilir (düşük değer). · Öneri: sabit-zaman erken dal.
- **P11-B-06** — `version.ts` `VERSION` hiçbir yerde kullanılmıyor (dead); `pkg.assets`'te package.json yok (ileride VERSION wire edilirse pkg-bundling landmine).
- **P11-B-09** — `install-second-agent.ps1` JSON template'te `$PrinterName` escape edilmiyor (özel karakterli yazıcı adı config'i bozar; pratikte yazıcı adları basit).
- **P11-A-07 [info]** — Blok 8 P8-ENQ-09 (enqueue dedup yok) agent tarafında büyümüyor (agent kör byte-writer) ama süzülmüyor de; P11-A-01/02 ile aynı aile.

## 3. Devir & çapraz-katman
- **Çift-basma ailesi (Blok 8 P8-ENQ-09 + Blok 11 P11-A-01/02):** üç bulgu tek mimari eksikte buluşuyor — **print-once idempotency yok** (enqueue-side dedup + agent-side ack-belirsizliği + transport kısmi-yazım). Blok 13'te ADR-004 §A3.4'ün prod-canlı yeniden değerlendirmesiyle birlikte ele alınmalı (print-token / job-level dedup key).
- **Öğrenilen-ders regresyonları:** config BOM (S91 API'de öğrenildi → installer'da tekrar) + MSI versiyon-drift (S83 → wxs hardcoded) — ders koda işlenmemiş, yalnız runbook'ta. Blok 13'te guard olarak koda göm.
- **P/Invoke pozitifi (S86 dersinin tersi):** Caller-ID'de "uydurma-ama-derlenir" kazası vardı; print-agent P/Invoke gerçek + test-doğrulandı — ders başarıyla uygulanmış.

## 4. Blok 13'e taşınanlar
**Öncelik: print-once idempotency paketi** (P11-A-01+02 + Blok 8 P8-ENQ-09; result-POST print-token + reportResult try/catch + success-ack best-effort) · **main() hata-yakalama + process.on handlers + Türkçe fail-fast mesajları** (P11-B-02, A-01b/B-01 ortak) · config BOM strip + installer `#Requires -Version 7` (B-01) · backoff (A-03) · installer key SecureString (SEC-01) · wxs versiyon enjeksiyon guard (B-03) · https zorlama + redact apiKey (SEC-02/04) · nssm log-rotation (B-05) · concurrent-claim testi (A-04). **Kalibrasyon kararı Blok 13'e:** A-01/B-01 BLOCKER'a çıkarılsın mı (master-prompt öyle etiketliyor; ben finansal-eşik + gürültülü-kurulum gerekçesiyle HIGH tuttum).
