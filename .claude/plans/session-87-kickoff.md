# Session 87 — Kickoff / Devir

Restoran POS v5 — Session 87. Önce bağlamı kur: **CLAUDE.md** + **docs/context-anchor.md §2** (en üst = Session 86) + **.claude/plans/active-plan.md** (Phase 5 + "Pilot bitiş yol haritası") + gerekiyorsa **.claude/memory/decisions.md** → ADR-031 (Phase 5) + ADR-016 §12 Amd2 (Caller Bridge) + ADR-004 Amd3 (kasa codepage) + **docs/ops/deploy.md** + **docs/ops/backup-strategy.md** + **.claude/memory/scratchpad.md** (A5 açık kalemler). Detaylı devir: bu dosya.

## DURUM
main **`be37336`**, prod code **`2958e65`** (#288 canlı, DEĞİŞMEDİ), 0 açık PR. Session 86 = 7 PR (#291-297) — hepsi docs+C#+skill, **prod deploy GEREKMEDİ**. (Ek: #296 A5 kurulum-smoke runbook + #297 cutover runbook/scratchpad + BRIDGE_TOKEN prod-doğrulandı-hazır.)

Session 86 işleri:
- **#291 Caller Bridge readiness (ADR-016 §12 Amd2):** S85 X-Tenant-Id kontrat-fix'i ilk kez `dotnet build/test` edildi (Caller Bridge C#, CI-dışı → lokal yetki; **12/12 PASS**). Eksik 2 spec kalemi kapatıldı: README (TenantId + `/api` + 400) + `BridgeApiClientTests.cs` (header regression guard). 🔑 **route-mount doğrulandı: `ApiBaseUrl=https://restoranpos.org/api` ŞART** (mount `/bridge/caller-id` app.ts:180 + Nginx `/api` strip; çıplak domain→SPA/404). Bayat `caller-id-bridge` SKILL.md yeniden yazıldı. Chip `task_fb088171` işi bitti.
- **#292 A4 KVKK paketi execute-hazır:** `aydinlatma-metni-taslak.md` [ALANLAR] dolduruldu (İlhan Avcı/Dilan Pide · Mürefte Mah. Şarköy-Tekirdağ · 0539 840 08 56 · ilhanavci499@gmail.com). 🔒 Kullanıcı VERBİS alanına TC Kimlik No vermişti (checksum yakaladı) → **yayınlanmadı** (minimizasyon). m.9/VERBİS güncel mevzuat teyidi (Bölüm C/F): **Almanya yeterlilik YOK** → uygun güvence; 🚩 **Hetzner Türk-SCC imzalamayabilir** (ceza yalnız veri sorumlusuna → fallback taahhütname+Kurul izni) = avukat düğümü; **VERBİS muaf** (<50 & <100M TL); 5-gün Kurul bildirimi geçerli.
- **A2 ✅** (prod salt-okunur teyit: 2 admin + 1 garson, kara liste 0).
- **🎯 A6 pilot çekirdek smoke ✅** (kullanıcı canlı, Adisyo'ya dokunmadan): mobil sipariş→mutfak fişi Türkçe + web kasiyer + mobil↔web senkron. **Pilotun çekirdeği uçtan uca kanıtlandı.**
- **KULLANICI KARARLARI:** (1) **KDS yok** — kağıt fiş yeterli (A5.1 düştü). (2) **A4 hukuki icra pilotta bilinçli ertelendi** (paket hazır; PII zaten prod'da → yükümlülük açık taşınıyor, bilinçli kabul).

**PROD:** 67 ürün · 25 masa · 1469 müşteri · 3 kullanıcı (2 admin+1 garson) · 2 agent (mutfak JP80H canlı) · gece şifreli off-site yedek CANLI · migrations head 043.

## SIRADAKİ (Phase 5 kalan — AZALDI; hepsi [USER]/[OPS]/cutover; [KOD] fiilen bitti)
- **A5 [USER/OPS] — Caller Bridge donanım pilotu (opsiyonel, go-live bloke DEĞİL):** Cihaz **USB-HID ✅ teyitli** (kullanıcı). Cihaz P/Invoke **#294'te düzeltildi** — shipped `cidOpen/cidIsRing/...` UYDURMAYDI → gerçek **`SetEvents` callback** modeline yeniden yazıldı (ADR-016 §12 Amd3; build/test 12/12 ama **donanım-DOĞRULANMAMIŞ**). Kalan: kullanıcı **`cid.dll`'i `cidshow_x64\` alt-klasörüne** koyar (v3 kopyası `D:\dev\restoran-pos-v3\tools\callerid-sdk-helper\cidshow_x64\cid.dll` +x86) + `dotnet publish` + `install-service.ps1` + `appsettings.json` (**`ApiBaseUrl=https://restoranpos.org/api`** — `/api` şart!, `BridgeToken`, `TenantId`) + **prod `BRIDGE_TOKEN`** env (API sunucu — Claude SSH, onayla) + smoke (kendini ara → `Ring detected` log + popup). **SetEvents cihazda patlarsa → `node-hid` muadili HID-read fallback (ayrı amendment); log'u Claude'a ver.** Adım-adım kurulum+smoke: `docs/ops/caller-bridge-kurulum-smoke.md`.
- **B (CUTOVER GÜNÜ — Adisyo bırakılınca; ⛔ Zadig YASAK şimdilik):** kasa agent Zadig→WinUSB + `install-second-agent.ps1 -JobKinds bill` + VID/PID + `codepage-scan.ps1` ile **61 ampirik teyit** + adisyon fiş smoke · kasiyer istasyonu (kiosk) · test verisi temizliği + order_no 1'den · go-live smoke + go/no-go (`apps/api/scripts/ops/go-live-p95-check.sh` — önce Nginx log_format `$request_time`; charter p95<200ms + pm2 restart 0) · rollback hazır (>30dk sipariş yok → Adisyo). **Adım-adım taslak: `docs/ops/cutover-gunu-runbook.md`.**
- **C** stabilizasyon 2-4 hafta (günlük pm2 + haftalık `rclone lsl` + p95 + aylık restore drill) → kriterler OK → **Adisyo iptali = PİLOT BİTİŞ**.
- **⏸ ERTELENDİ/KAPSAM-DIŞI:** **A4 hukuki tesisi** (paket hazır, kullanıcı pilotta erteledi — şikayet/talep gelirse avukat+yayın) · **KDS** (kağıt fiş yeter) · **[KOD ileride] P5-6** CONCURRENTLY gate (ilk canlı-veri migration'ında) · **[D pilot sonrası, ultracode 🔶]** v5.1 derin bug/güvenlik/yük denetimi (ayrı kickoff).

## PROD ERİŞİM & DEPLOY
SSH `ssh -i ~/.ssh/restoran_pos_ed25519 root@167.233.78.127`. Deploy (deploy.md §4): lokal `GIT_SSH_COMMAND="..." git push prod main` → sunucuda `cd /opt/restoran-pos && git pull origin main && pnpm --filter @restoran-pos/shared-types build` (ŞART) + (web değiştiyse web build) + (API değiştiyse `pm2 restart pos-api`). **Web-only'de pm2 restart GEREKMEZ. Prod'a dokunmadan onay al** (salt-okunur health/DB hariç). docs/caller-bridge(C#)/ops-script prod runtime'ı etkilemez → deploy gerekmez.

**BACKUP:** Storage Box **BX11 `u628233.your-storagebox.de`** :23 SSH-key (`/root/.ssh/storagebox` + postgres kopyası). rclone remote `storagebox:restoran-pos-backups`. systemd `pg-backup.timer` gece ~03:00. `/etc/restoran-pos/backup.env` (`AGE_RECIPIENT` public). **age private key SADECE kullanıcı kasasında** (sunucudan silindi) → restore `backup-strategy.md` §7. Elle test: `sudo -u postgres bash -c 'set -a; . /etc/restoran-pos/backup.env; /opt/restoran-pos/apps/api/scripts/backup/pg-backup.sh'`.

## ORTAM
Windows native PG 17.10 `:5432` (servissiz → `pg_ctl -D D:/PostgreSql/data -w start`), `pos_dev`/`pos_test` @043. Test: `DATABASE_URL="postgresql://postgres:postgres@localhost:5432/pos_test" pnpm --filter @restoran-pos/api test`. Web fix'te typecheck+eslint+web build. shared-types dist ŞART. **Caller Bridge = C# (.NET SDK 9.0.312 kurulu, net8.0 hedef) — CI'da YOK, `dotnet build/test` `apps/caller-bridge/` içinde ayrı** (12/12 PASS S86). Uzak-PC (RustDesk) PowerShell paste çiftler.

## KURALLAR
ADR önce→kod; DoD; branch-first; cerrahi (kendi orphan'ını temizle); kapsam kilidi (v5.0'da yoksa v5.1/ADR); UI→hci+turkish-ux+i18n+tarayıcı; auth/PII/payment→security-reviewer; DB→db-migration-guard; merge öncesi CI POLL (required check yok ~20-30sn); prod'a onaysız dokunma; kapanışta anchor §2+plan+memory+kickoff güncelle.

**ULTRACODE:** effort hep max + ultracode iş-bazlı; fan-out+adversarial-verify'a değince "🔶 ultracode'a değer" derim, o mesajda "ultracode" eklersin; keyword'süz ağır işte dururum; sohbet/plan/[USER]/[OPS]/kapanış solo. [[feedback_flag_ultracode_when_worth_it]]

**CANLI KULLANIM:** Restoran menü/sipariş deniyor → gerçek UX bug'ları çıkıyor (#288 böyle doğdu). Tuhaflık gelince: kodda bul→cerrahi fix→typecheck/build→PR→CI→web deploy→hard-refresh doğrulat.

**TARAYICI YETKİSİ:** "tarayıcıda yetki veriyorum" dersen claude-in-chrome ile iş yaparım; para harcanan son adımda DUR + screenshot + AskUserQuestion onay; secret/kredensiyal (kısmi bile) transcript'e basılmaz, kullanıcı doğrudan alır. [[feedback_browser_purchase_pause_before_pay]]
