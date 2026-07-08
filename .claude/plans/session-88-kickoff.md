# Session 88 — Kickoff / Devir

Restoran POS v5 — Session 88. Önce bağlamı kur: **CLAUDE.md** + **docs/context-anchor.md §2** (en üst = Session 87) + **.claude/plans/active-plan.md** + **.claude/memory/decisions.md → ADR-004 Amendment 4** (spooler transport — BU OTURUMUN ANA İŞİ; "Definition of Done" bölümü hazır) + ADR-032 (jobKinds routing) + ADR-004 §5 (transport ailesi) + gerekiyorsa **docs/ops/cutover-gunu-runbook.md** + **docs/ops/deploy.md**. Detaylı devir: bu dosya.

## DURUM
main **`8aa01d6`**, **prod code `ad14c5a`** (S87'de deploy YOK — hepsi docs/agent-side/test), 0 açık PR. Session 87 = **3 PR (#307-309)**.

## Session 87 ne yaptı (özet — detay anchor §2 + [[project_session_87_summary]])
- **#307** Caller ID küçük artıkları (Serilog log yolu exe-yanı fix + `isMaskedNumber` bypass unit-test güçlendirme + **boş-pattern footgun guard** + servis-restart/reboot/çökme smoke §5.1 + cutover runbook sıkılaştırma).
- **#308** `codepage-scan.ps1` ğ/Ğ örnek byte fix.
- **🎯🎯 KASA YAZICISI (POS-80 USB, queue `KASA-2026`) v5 ile CANLI DOĞRULANDI — ZADIG'SİZ.** Kritik keşif: yazıcı Windows print QUEUE → ESC/POS **spooler RAW datatype** ile basılabiliyor (Zadig gerekmez, sürücü değişmez, Adisyo bozulmaz — round-trip sonrası Adisyo hâlâ basıyor doğrulandı). Gerçek `renderBillReceipt` byte'ları (ESC t 61) kusursuz Türkçe bastı → **codepage 61 EMPİRİK DOĞRULANDI**.
- **#309 ADR-004 Amendment 4 ACCEPTED — Windows Spooler RAW Transport.**

## ▶ SIRADAKİ — BU OTURUMUN ANA İŞİ: ADR-004 Amd4 implementasyonu [KOD]
ADR **Accepted**, tam DoD hazır (`decisions.md` → ADR-004 Amd4 → "Definition of Done"). Sıra: **architect değil `implementer`** (ADR var). Akış (ADR'nin DoD checklist'ini birebir izle):
1. **`apps/print-agent/src/printer/config.ts`:** `SpoolerPrinterConfigSchema` (`type:'spooler'`, `printerName: z.string().min(1)`, `timeoutMs` default 10000); `PrinterConfigSchema` discriminatedUnion'a **3. dal**; `SpoolerPrinterConfig` type export. Backward-compat test (mevcut tcp/usb bozulmaz).
2. **`apps/print-agent/src/printer/spooler-transport.ts` (YENİ):** `sendToSpoolerPrinter(bytes, config)` — `process.platform !== 'win32'` guard (`SPOOLER_ERROR_UNSUPPORTED_PLATFORM`); **vendored C# NativeAOT yardımcı exe**'yi `child_process` ile spawn (byte'lar **STDIN**, `printerName` **argv**, `timeoutMs` aşınca child **kill**); exit-code→tipli `SPOOLER_ERROR_{PRINTER_NOT_FOUND(1801)/ACCESS_DENIED(5)/WRITE/TIMEOUT/SPAWN}`. `usb-transport.ts`'in settle / tek-settle race paterni (child-exit vs timeout-kill).
3. **Yardımcı exe (C# NativeAOT):** winspool `OpenPrinter → StartDocPrinter(DOCINFO pDatatype="RAW") → StartPagePrinter → WritePrinter(stdin) → EndPagePrinter/EndDocPrinter/ClosePrinter`. **S87'de bu C# kanıtlandı** (gist scratchpad'de kanıtlı RawPrinter — davranış REFERANS, kopya DEĞİL, sıfırdan yaz). Kaynak + build script repo'da; **prebuilt `.exe` `vendor/`'a commit** (nssm emsali `!vendor/` negation; **CI'da build YOK** — [[feedback_vendor_in_repo_binary]]). Helper yolu = `PRINT_AGENT_SPOOLER_HELPER_PATH` env → yoksa agent-exe komşusu (sibling) default. NativeAOT native linker/MSVC gerektirir → dev makinesinde build (repo'da .NET 8 SDK caller-bridge'den var).
4. **`apps/print-agent/src/index.ts` dispatch:** `if (usb) … else tcp` → **exhaustive `switch(printerConfig.type)`** (`never` tükenmişlik; spooler else'ten TCP'ye DÜŞMESİN) + `describePrinter` spooler dalı. Ana döngü `failed`-raporlama kontratı DEĞİŞMEZ.
5. **MSI/installer:** yardımcı exe payload'a (agent sibling); `install-second-agent.ps1`'e `printerName` param + config yazımı. **Lokal MSI smoke** ([[feedback_local_msi_smoke_faster]]) + Phase 3 install/uninstall E2E tekrar.
6. **Test (LOKAL — Caller Bridge gibi CI-dışı değil; print-agent CI'da):** config parse (spooler + backward-compat tcp/usb) · transport spawn-mock (stdin=bytes, argv=printerName, exit0→resolve, non-zero→tipli, timeout→kill) · non-win32 guard · dispatch exhaustiveness.
7. **Amd3 `Doğrulanmamış:` ESC t 61 etiketini KALDIR** (`esc-pos.ts` yorumu + `docs/ops/cutover-gunu-runbook.md` + `decisions.md` Amd3 metni) — S87 fiilen doğruladı (Amd4 Çözülen soru #2).
8. **security-reviewer** (yeni native binary spawn + vendored exe supply-chain + spawn-input hijyeni; auth/PII yok — byte opaque). i18n/hci YOK (config+servis). db-migration-guard YOK (migration yok).

**KARARLAR (S87 İlhan onayı):** toolchain=**C# NativeAOT** · Amd3 ESC t 61 doğrulandı → label kaldır · spooler=Windows-queue yazıcılar için **önerilen default** (libusb "yalnız WinUSB/sürücüsüz cihaz" olarak dokümante, kod ikisini tutar) · helper yolu env-override+sibling. **Kapsam kilidi:** yeni user-feature YOK; UI/per-yazıcı config/auto-discovery v5.1 (ADR-022).

## Sonra: cutover ([USER]/[OPS])
Spooler impl bitince kasa printing **Zadig'siz** → cutover'ın en riskli adımı elenir + Adisyo rollback penceresinde çalışır kalır. Kalan cutover: kasiyer kiosk + test verisi temizliği + `order_no` 1'den + go-live smoke + go/no-go (`go-live-p95-check.sh`, p95<200ms + pm2 restart 0) + rollback eşiği (>30dk → Adisyo). Runbook `docs/ops/cutover-gunu-runbook.md`. Codepage 61 fiziksel teyit ✅ ÖNDEN yapıldı. 2-4 hafta → Adisyo iptali = **pilot bitiş**.
⏸ ERTELENDİ: A4 KVKK hukuki tesis (paket hazır — 🚩Hetzner Türk-SCC) · KDS (kağıt fiş) · P5-6 CONCURRENTLY gate (ilk canlı-veri migration'ında) · **[D pilot sonrası, ultracode 🔶] v5.1 derin bug/güvenlik/yük denetimi**.

## PROD / DEPLOY / ORTAM
**PROD:** 67 ürün · 25 masa · 1469 müşteri · 3 kullanıcı (2 admin+1 garson) · 2 agent (mutfak JP80H TCP canlı; kasa `KASA-2026` cutover'da spooler-agent) + Caller ID bridge (dükkan PC) CANLI · gece şifreli off-site yedek · migrations 043.
**DEPLOY** (deploy.md §4): lokal `GIT_SSH_COMMAND="ssh -i ~/.ssh/restoran_pos_ed25519" git push prod main` → sunucuda `cd /opt/restoran-pos && git pull origin main && pnpm install --frozen-lockfile && pnpm --filter @restoran-pos/shared-types build` (ŞART) + (API değiştiyse `pm2 restart pos-api`). SSH `root@167.233.78.127`. **Prod'a onaysız dokunma** (salt-okunur health/DB hariç). print-agent/docs prod runtime'ı etkilemez → deploy gerekmez; ama **spooler impl agent binary + MSI** üretir (restoran PC'sine kurulum = cutover [OPS]).
**ORTAM:** Windows native PG 17.10 `:5432` (servissiz → `pg_ctl -D D:/PostgreSql/data -w start`), `pos_dev`/`pos_test` @043. Test: `DATABASE_URL="postgresql://postgres:postgres@localhost:5432/pos_test" pnpm --filter @restoran-pos/api test`. pkg=`@yao-pkg/pkg` node22-win-x64; `usb` native addon zaten `pkg.assets`'e gömülü (referans). **CI hâlâ tek otorite** — merge öncesi CI POLL.

## KURALLAR
ADR önce→kod (ADR-004 Amd4 zaten **Accepted** → doğrudan implementer); DoD; branch-first; cerrahi (kendi orphan'ını temizle); kapsam kilidi; DB→db-migration-guard; auth/PII/binary-spawn→security-reviewer; merge öncesi CI POLL (required check yok ~20-60sn); prod'a onaysız dokunma; kapanışta anchor§2+plan+memory+kickoff. **ULTRACODE:** fan-out+adversarial'a değince "🔶 değer" derim, o mesajda "ultracode" eklersin. **UZAK-PC SCRIPT (cutover/donanım):** [[feedback_gist_delivery_paste_safe]] (gist+irm) + [[feedback_powershell_alias_collision]] (tek-harf fonksiyon adı yasak) + PS5.1 encoding + [[feedback_destructive_op_live_hardware_warn_hard]] (canlı yazıcıda STOP+geri-alma önden).
