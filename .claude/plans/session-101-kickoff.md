# Session 101 — Kickoff (Session 100 devri, 2026-07-20 kapanışı)

## Tek cümlede

S100'de mutfağın **fırın/ızgara bölünmesi** kurtarıldı (cutover'da kaybolacaktı), garsonun 8 UX şikâyeti kapandı, sipariş iptali garsona açıldı ve **3 canlı açık** düzeldi — ama **hiçbiri prod'a çıkmadı**; S101'in ilk işi deploy.

## Durum

| | |
|---|---|
| main | **kod başı `3e706e9`** (#406) · migration head **048** · sonrası yalnız docs commit'i |
| **prod** | **`b335212` · head 047** — S100'ün hiçbir şeyi deploy EDİLMEDİ |
| Açık PR | yok (#403-406 merge edildi) |
| Prod'a dokunulan | yalnız Nginx `log_format` (+`rt=$request_time`) |
| Kabul edilen ADR | ADR-032 Amd1 (istasyon routing) · ADR-027 Amd2 (sipariş iptali) |

⚠️ **ADR'lar `.claude/plans/` altında, `decisions.md`'ye TAŞINMADI.** İkisi de Accepted. Taşıma S101'in bir işi:
`adr-032-amd1-mutfak-istasyon-routing.md` · `adr-027-amd2-mobil-siparis-iptali.md` · (+`adr-032-amd1-yazici-yonetimi.md` = Amd2 adayı, cutover sonrası)

## S101 — sıralı iş listesi

### 1. PROD DEPLOY (ilk iş, her şey buna bağlı)

```
git push prod main
# sunucuda:
cd /opt/restoran-pos && git pull origin main
pnpm --filter @restoran-pos/shared-types build     # ŞART — atlanırsa enum bayat kalır, arıza SESSİZ olur
pnpm --filter @restoran-pos/db migrate             # Migration 048 (additive-only, davranış-nötr)
pm2 restart pos-api
# web değişti → web build + deploy
```

**Migration 048 davranış-nötr:** tüm `print_station` NULL → çıktı bugünküyle birebir aynı. Deploy tek başına hiçbir şeyi değiştirmez; bölünme ancak atama SQL'i çalıştırılınca açılır.

Deploy sonrası **doğrulanacaklar** (S100'de prod'da test EDİLEMEDİ):
- Mobil sipariş iptali gerçekten çalışıyor mu (S100'de prod'da eski kod olduğu için 409 alıyordu)
- Ödemesi alınmış adisyonda *"Bu adisyonun ödemesi alınmış"* mesajı çıkıyor mu
- Web'de aynı akış aynı davranıyor mu

### 2. Mutfak istasyon bölünmesini AÇMA (sıra kritik — atama EN SON)

1. ~~Migration~~ → deploy ile geldi
2. ~~Server code~~ → deploy ile geldi
3. **Yeni exe build** + dükkan PC'sine kurulum (K7 reçetesi: `Stop-Service` → `print-agent.exe` + `spooler-raw.exe` kopyala (SHA + `.bak`) → `Start-Service` → **üç servisin** boot log'unu doğrula). ⛔ **MSI upgrade YAPILMAZ** — nssm `AppEnvironmentExtra` (API_URL/KEY) siliniyor, canlı mutfak agent'ı sessizce ölür.
   ⚠️ **Build'den ÖNCE `apps/print-agent/package.json` sürümünü 0.0.3 → 0.0.4 yap.** Dükkanda ŞU AN çalışan exe zaten **0.0.3** (S97 cutover'ı); bump etmezsen boot log'unda yeni ile eski **ayırt edilemez** → "kopyaladım ama eski çalışıyor" hatası sessiz kalır. Kabul kanıtı: üç servisin boot log'unda `0.0.4`.
4. Mevcut mutfak agent config'i `jobKinds:["kitchen"]` teyidi — **dosyaya bakmak YETMEZ**: `loadJobKinds()` önce env'e bakıyor. Üçlü kabul: (i) stdout log'da `jobKinds=kitchen`, (ii) `nssm get <svc> AppEnvironmentExtra`'da `PRINT_AGENT_JOB_KINDS` YOK, (iii) Machine env boş.
5. **IZGARA agent kurulumu** (TCP, spooler DEĞİL):
```powershell
.\install-second-agent.ps1 `
  -ServiceName RestoranPosPrintAgentGrill `
  -JobKinds grill `
  -PrinterHost 192.168.1.87 `
  -ConfigPath "$env:PROGRAMDATA\restoran-pos\print-agent-grill.json" `
  -DeviceFingerprint "$env:COMPUTERNAME-grill" `
  -ApiUrl "https://restoranpos.org/api" `
  -SetApiKey
```
   - `-ConfigPath` ZORUNLU (varsayılan kasa agent'ının CANLI dosyası)
   - `-ApiUrl` ZORUNLU (yoksa `localhost:4001`)
   - API key: **yeni key üretilmez**, prod `/root/pos-secrets.env` içindeki mevcut `PRINT_AGENT_API_KEY` girilir; ayrışma `device_fingerprint` ile olur
   - Kabul kriteri: stdout'ta `jobKinds=grill` + `register OK`, stderr'de **`HTTP 400` YOK** (1 dk idle poll), DB'de **üç canlı agent**
6. **Fiziksel smoke** (kapanış sonrası, ~2 saat) — üç yazıcı, çapraz-kontaminasyon yok
7. **Smoke YEŞİLSE atama SQL'i** — iki fazda: önce yalnız `KARIŞIK IZGARA` → uçtan uca test → sonra kalan iki kategori + İÇECEKLER

**Kategori eşlemesi (İlhan verdi):**
- FIRIN (`kitchen`, mevcut hat): PİDE · LAHMACUN · ÇORBALAR · SALATALAR · TATLI
- IZGARA (`grill`, yeni): KARIŞIK IZGARA · IZGARA ÇEŞİTLERİ · DÜRÜMLER
- İÇECEKLER: `kitchen_print=false` (mutfağa hiç gitmez; **KDS'ten de düşer** — İlhan kabul etti)

**Atama SQL kalıbı zorunlu:** `WHERE tenant_id='<T>' AND deleted_at IS NULL AND id IN (<UUID>)` — **kategori ADI ile eşleme / `ILIKE` / `lower()` YASAK** (Türkçe İ/I tuzağı). Önce `SELECT id,name` ile UUID'ler alınır, her UPDATE `RETURNING` ile satır sayısı doğrulanır.

**Geri alma (K10 — tek SQL DEĞİL, sıralı üç):** önce uçuştaki `grill` job'ları `kitchen`'a döndür (yoksa yetim kalır, kitchen agent kind filtresi yüzünden **reclaim de edemez**), sonra `print_station=NULL`, sonra doğrula. K13 uygulandıysa İÇECEKLER `kitchen_print=true` dördüncü satır.

### 3. ADR'ları `decisions.md`'ye taşı
### 4. Cutover hazırlığı (tarih İlhan'la yeniden konuşulmalı — 24-26 Tem penceresi S100'de teyit edilmişti ama iş büyüdü)
- `docs/ops/cutover-gunu-runbook.md` hâlâ **"TASLAK"** ve **raster geçişini bilmiyor**: §2'deki `codepage-scan.ps1`/CP857 reçetesi ADR-004 Amd9 K3'e göre **GEÇERSİZ** ("ESC t codepage gerekmez"). Aynı bayatlık `restaurant-pc-install.md` §6/§8'de.
- p95: veri birikiyor; ölçüm `bash apps/api/scripts/ops/go-live-p95-check.sh --path /api`. **pm2 restart taban = 41.**
- Test verisi temizliği · order_no 1'den · rollback provası

### 5. Mobil yayın dalgası (Apple onaylandı 2026-07-20)
EAS build bekleyen: ADR-026 Amd3 (porsiyon/özellik) + Amd4 (pastel) + **S100'ün 8 UX bulgusu + iptal**. Garson telefonundaki APK `ebf43e53` bunların hiçbirini içermiyor. iOS 5+ cihaz; ADR-031 Amd1 **ad-hoc** (TestFlight gerekçeli reddedilmişti) → `eas device:create` ile UDID kaydı gerekir.

## Bilinmesi gereken tuzaklar (S100'de yaşandı)

- **`git checkout main` başarısız olunca `git pull` yanlış branch'e merge commit atar** → PR diff'i main'e girmiş işle kirlenir. S100'de oldu; `git checkout -B <branch> origin/main` ile düzeltildi. Merge sonrası branch durumunu **doğrula**.
- **PS 5.1 + BOM'suz .ps1 + Türkçe = script çalışmaz.** Yeni `.ps1` ya saf ASCII olacak ya UTF-8 BOM'lu. Kontrol: `ParseFile` ANSI'de kaç hata veriyor.
- **Modal içindeki akışta toast görünmez** (RN). Hata geri bildirimi modalın İÇİNDE olmalı.
- **RN'de yüzde yükseklik** yalnız belirli-yükseklikli ebeveyne karşı çözülür; bottom-sheet'te yüzdeyi SARMALAYICIYA ver, sheet'e `flex:1`.
- **Prod'a bağlı mobil testte yalnız ARAYÜZ doğrulanır**, sunucu davranışı doğrulanamaz (backend deploy edilmemişse). `apps/mobile/src/config.ts` S100 kapanışında LAN'a geri alındı.
- **Test dosyasında `db.destroy()` + `pool.end()` birlikte** → "Called end on pool more than once" → dosya FAIL görünür (testler geçse bile).

## Elde duran geçici dosyalar (dev makinesi `D:\`)
`fis-ustbilgi-testi.ps1` · `fis-ustbilgi-izgara.ps1` · `izgara-test-fisi.ps1` · `izgara-test-fisi-2.ps1` — tek komutla yeniden üretilebilir:
`pnpm exec tsx scripts/ops/render-station-test-receipt.ts --host <ip> --station <ad> --out <yol>`

## Kapsam dışı (sessizce geri gelmesin)
"1. MARŞ" gönderim sayacı · iptal fişinin kasa kopyası · `delivery` sipariş iptali (teorik) · yazıcı yönetim ekranı (Amd2, cutover sonrası)
