# Session 89 — Kickoff / Devir

Restoran POS v5 — Session 89. Önce bağlamı kur: **CLAUDE.md** + **docs/context-anchor.md §2** (en üst = Session 88) + **.claude/plans/active-plan.md** + gerekiyorsa **docs/ops/cutover-gunu-runbook.md** (§2 spooler'a güncel) + **decisions.md → ADR-004 Amendment 4** + **ADR-031** (Phase 5 kararları). Detaylı devir: bu dosya + [[project_session_88_summary]].

## DURUM
main **`eef69e6`**, **prod code `ad14c5a`** (S88'de deploy YOK — agent-binary/installer/docs/test), 0 açık PR. Session 88 = **2 PR (#311 PR-A + #312 PR-B)**.

## Session 88 ne yaptı (özet)
🎯 **ADR-004 Amd4 Windows Spooler RAW transport UÇTAN UCA İMPLEMENTE** → kasa printing **Zadig'siz hazır** (ADR S87'de Accepted'dı → doğrudan implementer akışı):
- **#311 PR-A:** `config.ts` spooler dalı + `spooler-transport.ts` (child_process spawn: bytes stdin, printerName argv, timeoutMs→kill, exit-code→tipli `SPOOLER_ERROR_*`) + `index.ts` exhaustive switch dispatch + **C# NativeAOT winspool helper** (`spooler-helper/`; `[DllImport]` OpenPrinter/StartDoc RAW/WritePrinter) + vendored `installer/vendor/spooler-raw.exe` 1.25MB + `.sha256` + **39 test** (spawn-mock matrisi + opt-in gerçek-exe smoke) + Amd3 `Doğrulanmamış` ESC t 61 label kaldır. security (BLOCKER yok) + qa gate ✅.
- **🎯 gerçek winspool P/Invoke smoke** (native-interop dersi): gerçek exe yanlış-queue → OpenPrinter Win32 **1801** → **exit 2**; argv yok → exit 1. "Uydurma-ama-derlenir" riski kapatıldı.
- **#312 PR-B:** MSI `SpoolerHelperExe` component + `install-second-agent.ps1 -PrinterName` (spooler config TAM) + msi.yml verify + **runbook §2 Zadig→spooler** + README spooler bölümü. Lokal `wix build` smoke ✓ (+537KB CAB).
- **MSVC Build Tools kuruldu** (NativeAOT link için; reçete [[feedback_nativeaot_windows_build]]).

## ▶ SIRADAKİ — CUTOVER ([USER]/[OPS]; [KOD] ana iş KALMADI)
Kasa printing kod+MSI+exe TAM hazır → cutover'ın en riskli adımı (Zadig sürücü değişimi, S84 kazası) yapısal elendi. **Cutover günü (runbook `cutover-gunu-runbook.md`, §2 güncel):**
1. Test verisi temizliği + `order_no` 1'den (prod'da 8 test order + 1 test ürün) — [OPS + kullanıcı onayı, canlı-veri → yedek teyidi]
2. **Kasa agent (spooler, Zadig'siz):** ⚠️ spooler-raw.exe agent-sibling S88'de GELDİ — restoran PC'sindeki eski MSI'da YOK → **yeni MSI build+kur, ya da exe'yi elle `%PROGRAMFILES%\Restoran POS\Print Agent\`'a kopyala** + `install-second-agent.ps1 -PrinterName "KASA-2026" -JobKinds bill -ApiUrl https://restoranpos.org/api -ApiKey <key>` (config TAM, VID/PID yok, Zadig yok)
3. Kasa fiş smoke: web'den öde → kasa fişi Türkçe doğru + tutar/kalem + **Adisyo round-trip** (hâlâ basıyor mu — sürücü değişmedi)
4. Go-live smoke (P5-5) + go/no-go (`apps/api/scripts/ops/go-live-p95-check.sh`, p95<200ms + pm2 restart 0)
5. Rollback eşiği: >30dk sipariş yok / veri şüphesi → Adisyo (K10; abonelik açık)

**Claude-destek rolü:** MSI build/kurulum yardımı · smoke doğrulama · go/no-go script · kağıt-fallback (`go-live-kagit-fallback-ve-egitim.md` hazır). Uzak-PC script: [[feedback_gist_delivery_paste_safe]] + [[feedback_powershell_alias_collision]] + [[feedback_destructive_op_live_hardware_warn_hard]].

2-4 hafta stabilizasyon → Adisyo iptali = **PİLOT BİTİŞ** → P5-5 DOCS (charter :124/:194-201 + forward-ref).

## ⏸ ERTELENMİŞ / KALAN
- **A4 KVKK hukuki tesis** (paket execute-hazır; 🚩 Hetzner Türk-SCC = avukat düğümü) — [USER/avukat]
- **KDS** düştü (kağıt fiş yeterli — S86 kararı)
- **P5-6 CONCURRENTLY gate** [KOD] — yalnız ilk canlı-veri migration'ı gerektiğinde (ADR-031 K12)
- **[D pilot sonrası, ultracode 🔶] v5.1 derin denetim** (bug/güvenlik/yük; ADR-031 D)

## PROD / DEPLOY / ORTAM
**PROD:** 67 ürün · 25 masa · 1469 müşteri · 3 kullanıcı · 2 agent (mutfak JP80H TCP canlı; **kasa `KASA-2026` cutover'da spooler-agent**) + Caller ID CANLI · gece şifreli off-site yedek · migrations 043.
**DEPLOY** (deploy.md §4): lokal `GIT_SSH_COMMAND="ssh -i ~/.ssh/restoran_pos_ed25519" git push prod main` → sunucuda pull + `pnpm install` + `shared-types build` (+API değiştiyse `pm2 restart pos-api`). SSH `root@167.233.78.127`. **Prod'a onaysız dokunma** (salt-okunur health/DB hariç). spooler = agent-binary+docs → **prod deploy GEREKMEZ** (kurulum restoran PC = cutover [OPS]).
**ORTAM:** Windows native PG 17.10 `:5432` (servissiz → `pg_ctl -D D:/PostgreSql/data -w start`), `pos_dev`/`pos_test` @043. Test: `DATABASE_URL="postgresql://postgres:postgres@localhost:5432/pos_test" pnpm --filter @restoran-pos/api test`. NativeAOT build reçetesi [[feedback_nativeaot_windows_build]] (MSVC + vcvars + vswhere PATH + cmd batch). pkg=`@yao-pkg/pkg` node22-win-x64. **CI tek otorite** — merge öncesi CI POLL.

## KURALLAR
ADR önce→kod (ADR-004 Amd4 bitti); DoD; branch-first; cerrahi (kendi orphan'ını temizle); kapsam kilidi; DB→db-migration-guard; auth/PII/binary-spawn→security-reviewer; UI→hci+turkish-ux+i18n; merge öncesi CI POLL (required check yok ~20-60sn); prod'a onaysız dokunma; kapanışta anchor§2+plan+memory+kickoff. **ULTRACODE:** fan-out+adversarial'a değince "🔶 değer" derim, o mesajda "ultracode" eklersin.
