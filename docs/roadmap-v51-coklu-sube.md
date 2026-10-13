# v5.1 Yol Planı — Çoklu Şubeye Geçiş ve Kalan Denetim Borçları

> **Durum:** 2026-10-13 (S142) · Kaynak: `docs/audit/dd-scope-triage.md` (satın-alma DD raporu) + B-planı kararı (S124, ürün sahibi)
> **Bu dosya ne DEĞİL:** mimari karar. Her faz **kendi ADR'siyle** açılır (Core Directive #2). Bu dosya yalnız **sıra** ve **gerekçe**.
> **Tek giriş kapısı:** o an üzerinde çalışılan faz `.claude/plans/active-plan.md`'de görünür.

## Neden bu sıra

Üç kısıt sıralamayı belirledi:

1. **Bağımlılık.** İzole demo tenant, tenant çözümü düzelmeden açılamaz. Ajan oto-güncelleme ile anahtar rotasyonu aynı kurulu `exe`'ye dokunuyor → tek cutover'da yapılmalı, yoksa dükkan iki kez kapanır.
2. **Canlı risk.** Auth ve agent-auth yolları **fail-closed**: yanlış değişiklik girişi ya da baskıyı **sessizce** durdurur. Bu yüzden ikisi de ayrı fazlarda, negatif kontrolle ve **restoran kapalıyken** iner.
3. **Değer.** Faz 1 bitmeden ikinci şube **açılamaz**; gerisi şube sayısı arttıkça acıyan kalemler.

## Kalemlerin bugünkü doğrulanmış durumu

S142'de koda karşı tarandı — dosya okumakla yetinilmedi (`dd-scope-triage.md`'nin kendi uyarısı).

| Kalem | Durum | Kanıt |
|---|---|---|
| DD **Kova A** (canlıyı ısıranlar) | ✅ 25/25 kapalı | triyaj dosyası |
| **MIM-1 · MIM-2 · VERI-1** (tenant izolasyon + RLS) | ✅ kapalı, prod'da | ADR-041, 26 tablo force-RLS, mig 054→065 |
| **MIM-7 gövdesi** (tenant çözümü) | 🔴 **AÇIK** | `routes/auth.ts:262` → `withTenant(db, deps.tenantId, …)` = sunucu sabiti |
| **OPS-2** (ajan oto-güncelleme) | 🔴 **AÇIK** — kalan tek DD Kritik'i | `agent_version` / auto-update için kod tabanında **sıfır** eşleşme |
| **ADR-004 Amd14 K3** (kayıt anahtarı rotasyonu) | 🔴 AÇIK | prod: 4 ajan, `COUNT(DISTINCT api_key_hash) = 1` |
| İzole demo/test tenant | 🔴 AÇIK | Play Store inceleyicisine giriş verilemiyor; sebep tek-tenant |
| SPOF · CD · Redis · down-migration | 🟡 bilinçli ertelenmiş | charter + DD Kova B/C |

---

## Faz 1 — İkinci şubenin kapısı: tenant çözümü (MIM-7 gövdesi)

**Sorun.** Giriş akışı tenant'ı **sunucu sabitinden** alıyor (`deps.tenantId`). İkinci şube açıldığı an o şubenin personeli, kendi kaydı başka tenant'ta olduğu için **giriş yapamaz**.

**İyi haber — kapsam daraldı.** Üç çağrı noktasından **biri zaten çözülü**: ajan kaydı tenant'ı apiKey önekinden türetiyor (`pk_<8hex>_`, `routes/print-jobs.ts:657`). Kalan **iki** nokta:
- `routes/auth.ts` — login
- `auth/refresh.ts` — refresh rotasyonu

**Emniyet zaten var:** `tenants` tablosunda birden fazla satır olunca boot'ta `logger.error` + Sentry (**M6 sunset guard**, ADR-041 Amd7 K4). Yani ikinci tenant eklenince sistem **sessizce yanlış çalışmaz**, gürültü çıkarır.

**ADR'de karara bağlanacaklar:**
1. Tenant **neyden** türetilir? (e-postadan mı, giriş ekranında işletme seçiminden mi, alt-alan adından mı)
2. Kullanıcı tekilliği: aynı e-posta iki şubede olabilir mi? `users` üzerindeki UNIQUE kısıtı buna göre.
3. Refresh token ailesi tenant'a nasıl bağlanır (ADR-002 RTR'ı bozmadan).
4. M6 guard'ı ne zaman ve neye dönüşür.

**Zorunlu kapılar:** `architect` (ADR) · `security-reviewer` (**auth kontratı — zorunlu**) · `db-migration-guard` (şema değişirse) · `qa-engineer` (çapraz-tenant izolasyon testi).

**Riskler:** 🔴 fail-closed — hatalı değişiklik **tüm girişleri** kapatır. Negatif kontrol testi zorunlu; deploy **restoran kapalıyken**. 🔴 RLS: her yeni sorgu `withTenant` ister, yoksa **sessiz `rowCount=0`**.

---

## Faz 2 — İzole demo / test tenant

Faz 1'in **üstüne** oturur; ondan önce yapılamaz.

**Neden gerekli — iki ayrı sebep tek çözümde buluşuyor:**
- **Play Store:** Google'ın kendi yanıtı (S142, destek asistanı): *"Uygulamanız giriş gerektiriyorsa, inceleyenlerin test edebilmesi için **App access** bölümüne çalışan giriş bilgisi girmelisiniz."* Şu an giremiyoruz, çünkü çalışan her giriş **gerçek müşteri ve sipariş verisini** açar (KVKK).
- **Satış/demo:** ikinci işletmeye ürünü göstermenin yolu.

**Kapsam:** gerçek veriye dokunmayan, tohumlanmış bir tenant + o tenant'a bağlı demo hesap. RLS zaten canlı olduğu için izolasyonun **mekanizması hazır** — eksik olan tenant'ın kendisi ve tohum verisi.

**Çıktı:** Play Console → *Policy and programs > App content > App access* alanına girilecek çalışan kimlik bilgisi.

---

## Faz 3 — Ajan oto-güncelleme (OPS-2) **+** kayıt anahtarı rotasyonu (ADR-004 Amd14 K3)

**Bilerek tek faz.** İkisi de dükkandaki kurulu `exe`'ye dokunuyor. Ayrı yapılırsa restoran iki kez kapatılır ve iki ayrı cutover riski alınır.

**OPS-2 — DD'nin kalan tek Kritik'i.** Bugün kodda sıfır iz var. Tek işletmede elle cutover kabul edilmişti; 2-3 işletmede her restoranın print-agent'ını elle güncellemek sürdürülemez.
Gerekenler: `agent_version` heartbeat · sürüm kanalı · güvenli güncelleme (yarıda kalırsa eski sürüm çalışmaya devam etmeli) · geri alma.

**K3 — rotasyon.** Şu an tüm yazıcılar **tek ortak kayıt sırrı** paylaşıyor. ADR-004 Amd14 K2 (iptal edilmiş parmak izi yeniden kaydolamaz) **mutlak bariyer değil** — `device_fingerprint`'i istemci üretiyor. Gerçek kilit yalnız rotasyonla gelir.
Karar noktaları: grace penceresi · yeni anahtarın operatöre gösterimi · `api_key_hash`'in çoklu anahtarı nasıl taşıyacağı · audit (anahtarın kendisi **asla** yazılmaz).

**Risk:** 🔴 fail-closed — yanlış giderse **baskı sessizce durur**. Günlük ~1450 iş. Negatif kontrol + restoran kapalıyken deploy.

---

## Faz 4 — Dayanıklılık (şube sayısı arttıkça acır)

- **OPS-3** — prod dist build + versiyonlu release + **rollback** + CD. Bugün deploy elle; iki şubede hata geri alma süresi kritikleşir.
- **OPS-1 / MIM-4** — tek Hetzner box SPOF. Charter'da **bilinçli** tercihti; ikinci işletme geldiğinde "benim restoranım durur" değil "müşterimin restoranı durur" olur → hot-standby.
- **VERI-2** — riskli DDL'ler için down migration + runbook.

## Faz 5 — Ölçek (yalnız gerekirse)

- **MIM-3** — in-memory realtime → Redis adapter. **Yalnız çok-node gerektiğinde.** 2-3 şube tek node'da rahat çalışır; şimdi yapmak erken optimizasyon.

## Sürekli / fırsatçı (ayrı faz açılmaz)

Dokunulan modülde kademeli: **KOD-2** tanrı-dosyalar · **KOD-6** API zarf sözleşmesi · **KOD-8** SplitPaymentModal · **TEST-1** web UI test derinliği · **GUV-5** argon2id · **OPS-9** MSI imzalama (EV sertifika, büyümede) · **OPS-12** sıfır-kesinti + secret rotasyon runbook.

---

## Şu anda beklemede (faz değil, takip)

| Kalem | Ne bekleniyor |
|---|---|
| Play Store üretim başvurusu | Google kararı (~7 gün, 2026-10-13'te gönderildi) |
| Play Console destek kaydı | Başvurudaki yanlış cevabın düzeltmesi (~15 gün) |
| K8 `/auth/*` 429 izleme penceresi | **2026-10-18** → `systemctl disable --now auth-429-watch.timer` + sonucu `docs/ops/deploy.md` §10.1'e yaz |

## Bu dosya nasıl güncellenir

Faz açılırken: ADR yaz → `active-plan.md`'yi o faza çevir → burada fazın başına ADR numarasını yaz. Faz kapanınca: ✅ + PR numarası. Yeni bir DD maddesi gerçeğe karşı çürürse `dd-scope-triage.md`'de **ve burada** düzelt — kardeş-artefakt sapması bu projede tekrarlayan bir hata.
