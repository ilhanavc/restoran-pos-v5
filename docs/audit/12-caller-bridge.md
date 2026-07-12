# Blok 12 — apps/caller-bridge (.NET 8 Windows Service): derin denetim

> Derin denetim serisi Blok 12. **Tarih:** 2026-07-12 · **Branch:** `audit/12-caller-bridge` (base `a40b28a`) · **Model:** Fable 5.
> **Yöntem:** 3 paralel hat (A: security-reviewer — interop-gerçekliği/KVKK/auth · B: qa-engineer — Worker/API robustluk · C: qa-engineer — build/format/QUAL) + ana-context kod-doğrulama (interop deseni, çağrı-kaybı zinciri, README tasarım-niyeti bizzat okundu) + severity kalibrasyonu.
> **Canlı doğrulama:** `dotnet build -c Release` **0 uyarı/0 hata** (TreatWarningsAsErrors+Nullable enable); `dotnet test` **12/12**; `dotnet format --verify-no-changes` **1 whitespace ihlali**. Gerçek cihaz/prod API'ye dokunulmadı. Prod kod DEĞİŞTİRİLMEDİ.
> **Testler:** `apps/caller-bridge/audit/` 2 dosya (node:test .mjs statik-kaynak analizi — dotnet suite'ini kirletmez): **7 kasıtlı KIRMIZI + 7 yeşil.** Koş: `node --test apps/caller-bridge/audit/`.
> **Ham bulgu:** A:8 · B:8 · C:7 → konsolide **16 bulgu: 0 BLOCKER (2 sub-agent-BLOCKER'ı kalibre: biri tasarım-kabul→MEDIUM, biri→HIGH) · 3 HIGH · 8 MEDIUM · 5 LOW.**

---

## 0. Yönetici özeti

**Köprü kod-kalitesi örnek (0 uyarı, async-void yok, KVKK maskeleme eksiksiz), interop SAHTE DEĞİL (S86 dersi uygulanmış), auth kontratı sağlam. İki gerçek dayanıklılık boşluğu: (1) vendor DLL dış-kontratı hâlâ donanım-doğrulanmamış — yanlışsa çağrı sessizce hiç yakalanmaz; (2) interop-throw ve USB-kopma köprüyü toparlanmasız/sağır bırakabiliyor.**

**✅ Güçlü çıkanlar (kod/test/build-doğrulandı):**
- **Interop GERÇEK (S86 "uydurma-interop" dersinin karşıtı):** `CidShowDevice` gerçek `NativeLibrary.Load(cid.dll)` + `GetExport("SetEvents")` + gerçek callback kaydı (ADR-016 §12 Amd3 SetEvents-push; eski uydurma polling kaldırılmış); mock-sabit yok; delegate GC-rooting DOĞRU (singleton instance field'da, Program.cs `AddSingleton` yaşam-boyu); native callback try/catch'li (exception native'e sızmaz).
- **KVKK TEMİZ:** ham telefon hiçbir log yolunda yok; `PhoneMasking.Mask` (`055******67`) tüm 6 çağrı noktasında; ham numara yalnız HTTPS body'de; prod `appsettings.json` HttpClient→Warning (gövde loglanmaz); TCKN/isim yok.
- **AUTH sağlam:** X-Bridge-Token + X-Tenant-Id ikisi de (S86 fix yerinde) + ctor üçlü fail-fast; API-tarafı constant-time token compare; `/api` prefix prod'da doğru; repo'da gerçek token/TCKN yok (yalnız placeholder); `cid.dll`+secret gitignore'lu.
- **Kalite:** build 0-uyarı (TreatWarningsAsErrors+Nullable), async-void yok, suppress/TODO yok, mock/prod ayrımı temiz (`UseMockDevice:false` prod), dispose düzgün, 12/12 test.

**🟠 3 HIGH:**
1. **C12-A-01** — `cid.dll` dış-kontratı **donanım-doğrulanmamış** (kod başlığı+ADR §12 Amd2 açıkça "Doğrulanmamış"): 3 varsayım teyitsiz — `CallingConvention.Cdecl` (DLL `__stdcall` ise stack bozulur), `UnmanagedType.BStr` (LPWStr ise callback çöker), 5/6-arg callback şekli. **Kod-yanlış değil, dış-kontrat teyitsiz** — yanlışsa prod'da çağrı SESSİZCE hiç yakalanmaz.
2. **C12-B-01** — USB kopma toparlanması yok: `OnSignal` bilinçli No-op ("unused in the pilot scope") → kablo çekilip-takılınca köprü **kalıcı sağır** kalır (çökmez ama toparlanmaz), yalnız servis restart düzeltir; health/alarm yok. (README `drop-oldest` tek-çağrı kaybını kabul eder AMA bu sistemik sağırlık farklı.)
3. **C12-ROB-01** (B-02+C-02, iki hat aynı buldu) — `Workers/CallerBridgeWorker.cs:37` `_device.StartAsync` try/catch DIŞINDA → interop-throw (C12-A-01 senaryosu: eksik/yanlış DLL) `ExecuteAsync`'i fault eder → .NET 8 varsayılan `BackgroundServiceExceptionBehavior.StopHost` host'u durdurur → `Program.cs:65` üst-catch bunu YAKALAMAZ (StopHost temiz-çıkış gibi döner) → SCM restart tetiklemeyebilir → **köprü sessizce ölür**.

**Kalibrasyon (ana-context, gerekçeli):**
- **C12-B-03 çağrı kaybı: Hat B "BLOCKER" → MEDIUM.** README satır 16 `Channel<Incoming> (bounded, drop-oldest)` + Polly 3x retry (1s/2s/4s) = **best-effort teslimat MİMARİ KABUL**. Caller-ID nice-to-have UX (gelen çağrıda müşteri pop-up; kaçarsa telefon fiziksel çalmaya devam eder, kasiyer elle bakar — sipariş/para/geri-alınamaz-veri kaybı YOK). Gerçek eksik = **düşen-çağrı observability yok** (`PostIncomingAsync` bool dönüşü Worker'da yutuluyor, metrik/sayaç yok) → MEDIUM.
- **C12-B-01 USB kopma: Hat B "BLOCKER" → HIGH.** Best-effort tek-çağrı-drop'un ötesinde sistemik sağırlık (tüm gelecek çağrılar); ama nice-to-have + operatör USB-takarken fiziksel-müdahil + pilot-scope bilinçli → BLOCKER değil, HIGH (en azından health-check/alarm gerekir).
- **Kalibrasyon dersi:** README'deki tek satır (`drop-oldest`) bir "BLOCKER" iddiasını tasarım-kabule indirdi — sub-agent'lar tasarım-niyeti bilmeden BLOCKER şişirir (seri boyunca tekrar eden desen).

### En kritik 3
1. **C12-A-01** (HIGH) — `codepage-scan` emsali ampirik ilk-çağrı smoke: gerçek C812A'dan kendini ara, callback tetikleniyor mu + telefon doğru decode mu (cdecl/BStr teyidi). Donanım-smoke, kod-fix değil.
2. **C12-ROB-01** (HIGH) — `StartAsync`'i try/catch + `BackgroundServiceExceptionBehavior` / SCM-recovery netleştir; interop-throw sessiz-ölümü kapat.
3. **C12-B-01** (HIGH) — USB kopma health-check + otomatik yeniden-register veya en azından alarm.

---

## 1. Kapsam & yöntem
**Denetlenen:** `apps/caller-bridge/src/**` (Program.cs, Workers/CallerBridgeWorker, Devices/{CidShowDevice, MockCallerIdDevice, ICallerIdDevice, IncomingCallEvent}, Http/{BridgeApiClient, IBridgeApiClient}, Logging/PhoneMasking, Configuration/BridgeOptions, appsettings*.json, .csproj) + tests/** (3 dosya) + installer/README. Çapraz: ADR-016 §11/§12 Amd2/3, API-tarafı bridge-token middleware, caller-id-bridge skill.
**Araç:** `dotnet build/test/format` (koşuldu) + statik okuma. Gerçek cihaz/prod API'ye dokunulmadı.

## 2. Bulgular

### 2.1 HIGH (3)

### [HIGH] [INTEROP] cid.dll dış-kontratı donanım-doğrulanmamış (ID: C12-A-01) — SDK-karşı-teyitsiz
- **Dosya:** `Devices/CidShowDevice.cs:51-69` · **Kanıt (donanım-doğrulanmamış):** kod başlığı + ADR-016 §12 Amd2 açıkça "Doğrulanmamış". 3 dış varsayım gerçek CIDShow SDK'ya karşı teyitsiz: (a) `CallingConvention.Cdecl` — DLL `__stdcall` ise ilk çağrıda stack bozulur; (b) callback `[MarshalAs(UnmanagedType.BStr)]` — DLL LPWStr/LPStr veriyorsa çöp okur/çöker; (c) 5-arg callerId + 6-arg signal imza şekli. Hiç `ReadFile/HidD_/setupapi` yok — tüm yakalama cid.dll'e devredilmiş (tek teyitsiz bağımlılık).
- **Etki:** kod-yanlış DEĞİL; ama dış-kontrat yanlışsa prod'da çağrı **sessizce hiç yakalanmaz** (yanlış export ADI startup'ta gürültülü patlar; yanlış İMZA callback anında sessiz bozar). · **Öneri:** ampirik ilk-çağrı smoke (codepage-scan emsali) — en riskli ikili BSTR+cdecl. · **Etiket:** donanım-smoke (kod-fix değil)

### [HIGH] [ROB] USB kopma toparlanması yok → köprü kalıcı sağır (ID: C12-B-01)
- **Dosya:** `Devices/CidShowDevice.cs:143-146` (`OnSignal` No-op "unused in the pilot scope") · **Kanıt (kod-tespiti):** SignalCallback bağlantı/ring sinyalini atıyor; USB fiziksel kopma-algılama yok → kablo çekilip-takılınca callback sessizce durur, köprü çökmez ama **toparlanmaz** (tüm sonraki çağrılar kaybolur ta ki servis restart). · **Etki:** best-effort tek-çağrı-drop'un (README kabul) ötesinde sistemik sağırlık; health/alarm yok → operatör fark etmeyebilir. · **Öneri:** signal-tabanlı veya periyodik health-probe + otomatik re-register/alarm. · **Etiket:** MVP-fix

### [HIGH] [ROB] StartAsync try/catch dışı → interop-throw servisi sessizce durdurur (ID: C12-ROB-01, B-02+C-02 birleşik)
- **Dosya:** `Workers/CallerBridgeWorker.cs:37` (`_device.StartAsync` try DIŞINDA; try yalnız foreach'i + OperationCanceledException'ı sarıyor) · `Program.cs:16-65` (üst-catch `host.RunAsync`'i sarıyor ama ExecuteAsync arka-plan).
- **Kanıt (kod-tespiti + .NET 8 davranışı):** StartAsync fırlatırsa (C12-A-01: eksik/yanlış cid.dll) → ExecuteAsync fault → varsayılan `StopHost` host'u durdurur → RunAsync exception'suz döner → üst-catch YAKALAMAZ → SCM temiz-çıkış sanıp restart etmeyebilir → **köprü sessizce ölür, log bile yok.** · **Öneri:** StartAsync'i try/catch + `services.Configure<HostOptions>(o => o.BackgroundServiceExceptionBehavior = StopHost→Ignore?)` değerlendir + fail'de log+degrade. · **Etiket:** MVP-fix

### 2.2 MEDIUM (8)

- **C12-B-03 [ROB/observability]** — API-down + Polly-retry-tükenmesi/4xx'te çağrı düşer (README `drop-oldest`+retry = best-effort **tasarım-kabul**); gerçek eksik: `PostIncomingAsync` bool dönüşü `CallerBridgeWorker.cs:46`'da yutuluyor → **düşen-çağrı metrik/sayaç yok** (kaç çağrı kaybedildi görünmez). · Öneri: fail sayacı + periyodik log/telemetri. (kalibrasyon: BLOCKER→MEDIUM, §0)
- **C12-A-02 [observability]** — `CidShowDevice.cs:91` "registered SetEvents" INFO'su hiç çağrı gelmese de aynı → silent-fail maskeler (C12-A-01 ile birleşir). · Öneri: ilk-çağrı/heartbeat telemetri.
- **C12-A-05 [SEC]** — `BridgeApiClient.cs:35` ApiBaseUrl şema doğrulaması yok → `http://` misconfig'de token+ham PII cleartext (prod Nginx-TLS azaltıyor). · Öneri: localhost-dışı https zorla.
- **C12-A-06 [SEC/ops]** — çözülen endpoint startup'ta loglanmıyor; `/api` prefix elle-config (S86 tekrarı riski) yanlışsa her POST 404 → çağrı düşer, yalnız warning. · Öneri: startup'ta çözülen tam URL (token maskeli) logla.
- **C12-A-07 [SEC]** — `appsettings.json` token düz-metin diskte, dükkan PC'sinde ACL/env sertleştirme yok. · Öneri: dosya ACL veya `Bridge__BridgeToken` env override.
- **C12-B-04 [ROB]** — `Program.cs:40` tipli HttpClient tek singleton'da yakalanmış → `IHttpClientFactory` DNS-recycle faydası devre-dışı (uzun-ömür servis + IP değişimi). · Öneri: factory'den resolve veya SocketsHttpHandler PooledConnectionLifetime.
- **C12-B-05 [ROB/ops]** — `install-service.ps1:39` `sc failure` recovery crash-loop/sessiz-ölüme yol açabilir, operatör alarmı yok. · Öneri: recovery + event-log/alarm.
- **C12-TEST-01 [test-kapsam]** (B-06+C-03+C-05+C-06 birleşik) — kritik yollar test edilmemiş: `IBridgeApiClient.ThrowsAsync` exception-safety (mevcut test yalnız `ReturnsAsync(false)` soft-fail), ctor-guard 2/3 (`ApiBaseUrl`/`BridgeToken`), non-2xx warning-log yolu, PhoneMasking 6-hane sınır + `+90` uluslararası. · Öneri: eksik senaryolar + regresyon kilidi.

### 2.3 LOW (5)
- **C12-C-01 [format]** — `tests/PhoneMaskingTests.cs:11` whitespace ihlali (`dotnet format` düzeltir).
- **C12-A-03 [ROB]** — `CidShowDevice.cs:99-106` StopAsync `SetEvents(null,null)`/close'suz `NativeLibrary.Free` → DLL arka-thread hâlâ callback tutuyorsa shutdown-race (yalnız kapanış).
- **C12-C-04 [test]** — `CallerBridgeWorkerTests.cs:39,65` sabit `Task.Delay(150)` → yavaş CI'da flaky. · Öneri: TCS/callback deterministik bekleme.
- **C12-C-07 [kaynak]** — `CidShowDevice._libHandle` raw `nint` (SafeHandle değil) → finalizer güvenlik-ağı yok; pratik risk düşük (IAsyncDisposable + singleton + tek start/stop).
- **C12-HYG-01 [hijyen]** (A-04+A-08) — `appsettings.Development.json:4` commit'li `dev-bridge-token` (dev/localhost kabul; prod'la asla eşleşmemeli) + dev HttpClient override yok.

## 3. Devir & çapraz-katman
- **Interop-verify dersi (S86) BAŞARIYLA UYGULANMIŞ:** print-agent (Blok 11 P/Invoke gerçek) + caller-bridge (SetEvents gerçek, uydurma-polling kaldırılmış) — iki native-interop bileşeni de "derlenir-ama-uydurma" tuzağından çıkmış. Kalan tek açık: **dış SDK-kontratının ampirik teyidi** (her ikisinde de "donanım-doğrulanmamış" işareti; print-agent S88'de smoke geçti, caller-bridge henüz geçmedi → C12-A-01 en kritik).
- **best-effort teslimat teması:** caller-bridge `drop-oldest` (tasarım-kabul) — Blok 8/11 print çift-basma "at-least-once" ile kontrast; ikisi de observability-zayıf (kaç çağrı düştü / kaç fiş çift-basıldı görünmez). Blok 13'te telemetri/metrik ortak ihtiyaç.
- **S86 tekrar-riski:** `/api` prefix elle-config (C12-A-06) — S86'da "route-mount /api ŞART" dersi vardı; startup-log guard'ı olmadığından regresyon sessiz kalır.

## 4. Blok 13'e taşınanlar
**Öncelik: C12-A-01 ampirik ilk-çağrı smoke** (donanım — kullanıcı; gerçek C812A'dan self-call, cdecl/BStr teyidi) · StartAsync try/catch + BackgroundService exception davranışı (ROB-01, sessiz-ölüm) · USB-kopma health/alarm (B-01) · düşen-çağrı + fiş-çift-basma ortak telemetri (B-03 + Blok 8/11 aile) · https zorlama + endpoint startup-log + token ACL (A-05/06/07) · HttpClient factory-lifetime (B-04) · test-kapsam paketi (TEST-01) · whitespace + flaky-test + dev-token temizliği (LOW'lar). **Not:** bu blok 0 BLOCKER — 2 sub-agent-BLOCKER'ı gerekçeli kalibre edildi (README drop-oldest tasarım-kabul + nice-to-have kapsam).
