# Session 96 Kickoff — Prod deploy + smoke + FAZ 4 (dead-code & R7-TZ) kapanış

> **Giriş kapısı:** `docs/context-anchor.md` §2 → `docs/audit/00-summary.md` → bu dosya.
> **Audit+fix durumu:** `.claude/memory/project_deep_audit_series.md` · **İptal fişi:** `.claude/memory/project_iptal_fisi_plan.md`
> **Son güncelleme:** 2026-07-15 (Session 96 kapanış).

## Session 96 nerede bıraktı (ÖZET)

**🎯🎯 S94+S95 PROD'A DEPLOY EDİLDİ + 5-adım canlı smoke + FAZ 4 dead-code TAM + R7-TZ-12/13 KAPANDI.** 6 PR (#365-369 + anchor), main **`4592efa`**, **prod head 047, code `9a2171d`** (+doc `7e871fd`).

- **Deploy (restoran kapalıyken):** 9 fix canlı (#354-357 + #359 + Migration 047); ön-deploy ultracode-denetimi 0-BLOCKER (047-lock endişesi REFUTED: orders=24 satır); pg-backup → install → shared-types build → migration (migrator) → web build → pm2 → doğrulama tümü ✓. deploy.md 3 runbook-boşluğu #365 ile kapandı.
- **5-adım davranışsal smoke (Claude tarayıcıdan, kullanıcı yalnız login):** rate-limit ✓ · offline→ErrorState ✓ · Yazdır→queued-job ✓ · <1000₺-tek-tık + >1000₺-onay-Vazgeç-Onayla ✓ · 9-ekran i18n ✓. Bonus: ADR-033 void→reopen + masa-dolu-guard canlı doğrulandı. Temizlik voidle yapıldı, ciro ₺0'a döndü, DB baseline birebir.
- **#367+#368 dead-code:** 8 dosya + 12 sembol + 9 export-söküm, −174 satır. **Ders: knip taze koşulmalı** — S93 listesi ErrorState'i ölü sayıyordu, #355 canlıya bağlamıştı. Kalan knip çıktısı (5 dosya + 15 export) bilinçli yüzey.
- **#369 R7-TZ-12/13 — ADR-015 Amendment 5 (10 karar):** Z-raporu penceresi `store_date` tek-kaynak (SUM-invariant gün-sınırında), X-raporu değişmedi, sayaç `business_date` tx-içi SQL (ırk yapısal kapandı), takvim-dışı date→400, **date pg'ye string+`::date`** (gate SQL-TZ-01: JS-Date binding süreç-TZ-bağımlı). Test 5'li fix'siz-kırmızı + 2 ekstrem-TZ. Migration YOK.

**DESEN:** branch-first + ADR-önce + fix'siz-kırmızı + ultracode-Workflow-gate (S96'da 2 gate: pre-deploy 8-hat + TZ-fix 4-lens; ikisi de gerçek bulgu üretti) + CI-yeşil + squash-merge.

## ▶ Session 97 işleri

> **GÜNCELLEME (S96 devamı, aynı gün):** LOW/NIT (#371) ve iptal-fişi Part A (#372, ADR-004 Amd6) bu oturumda KAPANDI — aşağıdaki 1-2 yerini Part B'ye bıraktı. main `adee2fb`+.

### 1. [KOD] ADR-004 Amd6 **Part B** — print-once ack-dayanıklılığı (yeni exe)
- Agent `reportResult` try/catch + sınırlı backoff-retry (**B2 Tier-1**; #360 `computeBackoff` reuse) + `pollOnce` ack-yolu tam-guard; `RECLAIM_STALE_SECONDS` > ack-retry-bütçesi koordinasyonu (**B3**). Amendment kararları decisions.md ADR-004 Amd6 Bölüm B'de (B1-B5).
- Çıktı **YENİ EXE** → mutfak+kasa agent redeploy (S89 cutover reçetesi: nssm-env + config BOM'suz); #360/#361 exe-kuyruğuyla **birleşik cutover** — [USER] adımıyla koordine.
- Test: reportResult transient-fail → retried, çift-claim yok; ack-hatası döngüyü öldürmez (Amd6 DoD).

### 2. [KOD, opsiyonel] Kalan kalite
- 91 unused-exported-types (knip; gürültülü — değer/efor tartılır) · v5.1-backlog planlaması (`docs/audit/low-nit-devir.md` devir listesi).

### 3. [USER] deploy kuyruğu
- **S96 kod-PR'ları prod'a değil** (#367-369 + #371-372 main'de) — bir sonraki dalga (deploy.md; migration YOK; **shared-types dist build ŞART** + API restart + web build). Deploy sonrası **JP80H kağıt-smoke:** kalem iptal et → mutfaktan **'KALEM İPTAL'** fişi; adisyon iptal → **'ADİSYON İPTAL'**.
- **Yeni APK** (#361 + #345) sideload; **print-agent + caller-bridge yeni exe** (Part B ile birleşir); **C12-A-01 donanım-smoke** (pilot-öncesi zorunlu).
- Dükkan-PC açılınca kuyruktaki **"TEST" notlu adisyon fişini çöpe at** (S96 smoke artığı).
- **Admin şifresini değiştir** (S96'da sohbet kaydına düz-metin girildi).

## ▶ TAZE SOHBETE YAPIŞTIRILACAK PROMPT (Session 97)

```
Restoran POS v5 — Session 97. Önce oku: docs/context-anchor.md §2 + .claude/memory/project_deep_audit_series.md (+ MEMORY.md pointer) + CLAUDE.md + .claude/plans/session-96-kickoff.md.

DURUM: denetim 0-13 ✅ + fix FAZ 1-4 TAMAMEN ✅ (#371 LOW/NIT-kapanış+v5.1-devir) + 🎯 İPTAL-FİŞİ Part A ✅ (#372, ADR-004 Amd6: KALEM-İPTAL/ADİSYON-İPTAL→mutfak; cutover-SIFIR kind='kitchen'+meta.variant). main `adee2fb`+; prod head 047 code `9a2171d` (S96 kod-PR'ları #367-372 prod'a GİTMEDİ).
KALAN [KOD]: ADR-004 Amd6 **Part B** (agent reportResult ack-dayanıklılığı B2/B3 → YENİ EXE, #360-kuyruğuyla birleşik cutover) → opsiyonel 91-unused-types / v5.1-planlama. KALAN [USER]: S96-PR'ları sonraki prod dalgası (shared-types build ŞART) + JP80H iptal-fişi kağıt-smoke + yeni-APK + exe'ler + C12-A-01-donanım-smoke + TEST-fişi-çöpe + admin-şifre-değiştir.

BUGÜN başlamak istediğim: [SEÇ — örn. "Amd6 Part B (reportResult+yeni exe)" / "S96 PR'larını prod'a deploy" / "v5.1 planlaması"].

Desen: branch-first + ADR-önce(yapısal) + cerrahi + fix'siz-kırmızı regresyon + tam-suite(lokal pos_test, DATABASE_URL) + ultracode-Workflow-gate(bulguları ana-context'te doğrula-yamala) + CI-yeşil. Türkçe yanıt.
```

## Notlar
- **pos_test** lokal DB head **047**, şifre postgres; PG başlatma: `D:\PostgreSql\bin\pg_ctl.exe start -D D:\PostgreSql\data` (Start-Process detach + poll; C:\Program Files\PostgreSQL\17\ altında yalnız ESKİ data var, binari YOK).
- Audit draft #329-341 arşiv; rapor dosyası gerekince `git fetch origin <branch> --depth 1` + `git show FETCH_HEAD:docs/audit/NN-*.md` (S96'da 07-reports.md böyle alındı).
- **4 chip açık:** `task_9905a8eb` web-i18n-komşu · `task_c554652f` print-agent-robustness · `task_e452b4ef` caller-bridge-Blok12+C12-A-01 · `task_20f0e0c9` eski SplitPaymentModal-i18n (muhtemelen #359'da superseded — kontrol edilip düşürülebilir).
