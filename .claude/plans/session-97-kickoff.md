# Session 97 Kickoff — ADR-004 Amd6 Part B (reportResult ack-dayanıklılığı → yeni exe)

> **Giriş kapısı:** `docs/context-anchor.md` §2 → bu dosya.
> **Audit+fix durumu:** `.claude/memory/project_deep_audit_series.md` · **İptal fişi:** `.claude/memory/project_iptal_fisi_plan.md`
> **Son güncelleme:** 2026-07-16 (Session 97 kapanış).

## Session 97 nerede bıraktı (ÖZET)

**🎯 ADR-004 Amd6 Part B TAMAM — çift-basma ailesi (P11-A-01/A-02) KOD-KAPANDI + yeni exe 0.0.3 hazır.** 1 PR (#374 squash), main **`c640453`**; **prod'a DEPLOY YOK** (prod hâlâ head 047 code `9a2171d`; S96+S97 kod-PR'ları prod dalgası bekliyor).

- **B2:** `ack.ts` — `ackWithRetry` (#360 `computeBackoff` reuse, 4 deneme 1→3→9s; YAPISAL asla-reject: attempt VE sleepFn guard'lı) + `classifyAckHttpStatus` (5xx/408/429 retriable; deterministik 4xx fatal — bütçe yakılmaz). `reportResultOnce` fetch try/catch + `AbortSignal.timeout(10s)`.
- **Asıl kilit (gate bulgusu):** `process-job.ts` — job akışı (decode→dispatch→ack) test-edilebilir modüle çıkarıldı; **baskı-OK + ack-hatası → 'failed' ASLA raporlanmaz** (eski akış bunu yapıp re-queue→çift-baskı üretiyordu). 10 test + **dürüst-kırmızı kanıt** (iki savunma katmanı geçici sökülünce test kırmızı).
- **B3 iki-taraf:** 53s ack + 10s transport + 15s marj = 78 ≤ 90s reclaim. Agent: `ack.test.ts` bütçe-guard (şema-türetimli) + şema-max(60s)-aşımı belgeli + `config.ts` TimeoutMsSchema kuralı. Server: `print-jobs.ts` RECLAIM yorumu Amd6-matematiğiyle + **78s taban-uyarısı** (env unset → davranış SIFIR; uyuyan-warn sonraki API dalgasıyla gider).
- **Ultracode gate ×2 tur** (4 mercek; 2'si session-limit'e düştü → script lens-etiket fix'i + resume ile kurtarıldı — `feedback_workflow_resume_after_session_limit` uygulandı): 8 bulgu → hepsi yamalı, 0 açık.
- **Versiyon 0.0.2→0.0.3** (package.json + wxs; S83 bump dersi). **Exe build + boot-smoke ✓:** `apps/print-agent/dist/exe/print-agent.exe` (70MB; temiz fail-fast + register-hata yolu).
- Doğrulama: print-agent 68/68 · api print testleri 34/34 (lokal pos_test) · typecheck/lint temiz (api 3 warning pre-existing: bridge-token.ts:18 + print-agent-auth.ts:29 + print-jobs.ts:513 unused-disable) · CI ×3 yeşil.

**DESEN:** branch-first + ADR-implementasyonu (Amd6 B kararlıydı) + fix'siz-kırmızı (2×: modül-yok + bug-inject dürüst-kırmızı) + ultracode-gate×2 + CI-yeşil + squash-merge.

## ▶ S97-devamı'nda EK OLARAK BİTENLER (2026-07-16, aynı gün)

- **🎯 PROD DALGASI DEPLOY:** S96+S97 kod-PR'ları prod'a gitti (`ca54ee9`), migration yok, shared-types build + web build + pm2 restart.
- **🎯 EXE CUTOVER 0.0.3 CANLI:** mutfak+kasa yeni exe (Part B ack-dayanıklılığı devrede); RustDesk→`C:\temp`→gist `guncelle-exe-003.ps1` (SHA256+boyut guard + servis-keşif + yedek `.002.bak` + geri-alma). 2 servis Running, register OK.
- **🎯 JP80H KAĞIT-SMOKE ✓✓:** KALEM İPTAL + ADİSYON İPTAL + kasa fişi (kullanıcı fotoğrafladı; Türkçe İ/ş/ı temiz; meta.variant DB-teyitli) → **ADR-004 Amd6 DoD TAM.**
- **🎯 ADR-014 Amd1 — OTOMATİK SİPARİŞ İPTALİ (yeni ADR, prod `126434e`):** smoke'ta bulundu (son/tek kalem iptalinde masa açık+₺0 kalıyordu, v3 paritesi eksik). Fix K1-K9 + gate (para/eşzamanlılık TEMİZ) + 808/808 + prod canlı auto=true audit. Chip `task_219e7c0a` (dine-in explicit-cancel audit boşluğu, ayrı iş).
- **🎯 YENİ APK CANLI (#361 + #345):** EAS production build (kullanıcı tarayıcı-login → Claude build+izleme; **aynı keystore** "Build Credentials 0tEmZn3U-0" → üstüne-kurulum, veri korundu). Link-doğrulama dersi: telefonda elle-yazılan link `BUILD_NOT_FOUND` verdi → **QR-kod ile teslim** (segno SVG, ekrandan kamera-okutma) çözdü. Kullanıcı tam smoke ✓: mobil-veri login + masalar + sipariş→mutfak + realtime + çevrimdışı-bandı (#361). Build ID `3ddfe996`.

## ▶ S97-devamı-4'te EK BİTEN (aynı gün): CALLER-BRIDGE CUTOVER + C12-A-01 ✅

Yeni build (#307+#362) dükkan-PC'de canlı (appsettings'siz-zip + SHA-guard'lı gist-script; canlı config/cid.dll korundu). **C12-A-01 ampirik kapandı:** `registered SetEvents` + maskeli `Ring detected` (KVKK ✓) + `Incoming call posted` + `call_logs` + popup + `CidShow signal` (#362 gözlemlenebilirliği canlı; C812A seri 4C27A9624). ADR-016 §12 Amd3 şerhi + README güncellendi. **Pilot-öncesi teknik kuyruk BOŞ.**

## ▶ Session 98 işleri

### 1. [USER] kalan küçük işler
- **Admin şifresini değiştir** (S96'da sohbete düz-metin girildi) · **EAS keystore'u kasaya yedekle** (runbook §4 K9-zorunlu: `eas credentials` → Android → keystore indir → parola yöneticisi + offline; EAS-hesap-kaybı = imza-kaybı) · dükkan `C:\temp` + Masaüstü zip artıkları temizlenebilir.

### 1b. [PLANLAMA] Pilot / cutover-günü
- Teknik ön-koşullar tamam → ADR-031 go/no-go kalemleri gözden geçirilip **kasiyer-kiosk + test-verisi temizliği + `order_no` 1'den + Adisyo-bırakma günü** planlanabilir (S91 kickoff'undaki cutover-planı referans).

### 2. [KOD, opsiyonel] Kalan kalite / planlama
- Chip `task_219e7c0a` (dine-in explicit-cancel `order.cancelled` audit paritesi — 3-yol tutarlılığı).
- v5.1-backlog planlaması (`docs/audit/low-nit-devir.md`) · 91 unused-exported-types (knip; gürültülü).

## ▶ TAZE SOHBETE YAPIŞTIRILACAK PROMPT (Session 98)

```
Restoran POS v5 — Session 98. Önce oku: docs/context-anchor.md §2 + .claude/memory/project_deep_audit_series.md (+ MEMORY.md pointer) + CLAUDE.md + .claude/plans/session-97-kickoff.md.

DURUM: denetim 0-13 ✅ + fix FAZ 1-4 ✅ + İPTAL-FİŞİ Part A+B ✅ (ADR-004 Amd6 KOD TAMAM; #372+#374; exe 0.0.3 hazır apps/print-agent/dist/exe/). main `c640453`; prod head 047 code `9a2171d` (S96+S97 kod-PR'ları #367-374 prod'a GİTMEDİ).
KALAN [USER]: prod dalgası (shared-types build ŞART) + exe-cutover-0.0.3 (mutfak+kasa; #360/#361 birleşik; S89 reçetesi) + JP80H iptal-fişi kağıt-smoke + yeni-APK + C12-A-01 + TEST-fişi-çöp + admin-şifre. KALAN [KOD, ops.]: v5.1-planlama / 91-unused-types.

BUGÜN başlamak istediğim: [SEÇ — örn. "prod deploy + exe cutover (ben dükkandayım)" / "v5.1 planlaması"].

Desen: branch-first + ADR-önce(yapısal) + cerrahi + fix'siz-kırmızı regresyon + tam-suite(lokal pos_test, DATABASE_URL) + ultracode-Workflow-gate(bulguları ana-context'te doğrula-yamala) + CI-yeşil. Türkçe yanıt.
```

## Notlar
- **pos_test** lokal DB head **047**, şifre postgres; PG başlatma: `Start-Process 'D:\PostgreSql\bin\pg_ctl.exe' -ArgumentList 'start','-D','D:\PostgreSql\data'` detach + pg_isready poll (S97'de 14sn'de kalktı).
- Workflow gate script'inde lens-etiketleme `filter(Boolean)` sonrası index'le YAPILMAZ (bulgu yanlış merceğe atfedilir) — null'ları yerinde bırakıp `flatMap((r,i) => r===null ? [] : ...)` kullan (S97 dersi, script-dosyasında düzeltildi).
- **4 chip açık:** `task_9905a8eb` web-i18n-komşu · `task_c554652f` print-agent-robustness (**Part B sonrası büyük ölçüde kapandı — içeriğine bakıp düşürülebilir**) · `task_e452b4ef` caller-bridge-Blok12+C12-A-01 · `task_20f0e0c9` eski SplitPaymentModal-i18n (muhtemelen #359'da superseded).
