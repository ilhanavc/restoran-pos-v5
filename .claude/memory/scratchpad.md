# Scratchpad

Oturumlar arası geçici notlar. Kalıcı karar varsa ADR olarak `decisions.md`'ye taşı. Bitmiş görev varsa `active-plan.md`'de ✅ işaretle.

## Açık sorular

<!-- Çözüm bekleyen teknik/ürün soruları -->

- [ ] Proje adı kesinleşsin mi? (şimdilik `restoran-pos-v5`)
- [ ] İlk pilot restoran (kendi restoranım) için hangi özellik set'i MVP'de olmalı? v3 referans alınacak ama kapsam küçültülecek
- [ ] Print Agent Windows Service mi olacak, yoksa sistem tray'inde çalışan basit bir uygulama mı?

## Yapılacaklar notları

<!-- Atlanmaması gereken küçük şeyler -->

- v3 repo'sunu okuma-sadece mount et, copy-paste riskini azalt
- v3'ten değerli parçaların listesi: hangisi mimari referans, hangisi davranış referansı, hangisi test senaryosu
- Hetzner hesap kurulumu Phase 1'e girmeden yapılmalı

## ADR-002 açık kararlar

<!-- ADR-002 (Auth stratejisi) yazılırken bu kararlar şartname olarak taşınacak -->

- **Şifre sıfırlama stratejisi (hibrit):**
  - v5.0 MVP: admin reset (Ayarlar → Kullanıcı Yönetimi'nden elle)
  - v5.0 backend: email token endpoint yazılır ama UI'da gösterilmez (ready-but-disabled)
  - v5.1: feature flag ile aktif edilir

## v3 bulguları — mimari sinyaller

<!-- v3 reference röportajları sırasında çıkan, v5 mimari kararlarını etkileyecek sinyaller -->

1. **Garson rol kapsamı v3'te daraltılmış** — yalnız `/tables` route. Sipariş yönetimi masa detayı içinde entegre, ayrı `/orders` route yok. **How to apply:** v5 Modül 4 (Masa) tasarımında dikkat edilecek, garson UX masa ekranı merkezli akacak.

2. **Rol matrisi v3'te tek merkezi yerde** (`tD` nav array). Config-driven yaklaşım, her component'te tekrar etmez. **How to apply:** v5'te korunacak — ADR-002 kuralı: "role → routes mapping tek bir config dosyasında, frontend nav + backend guard aynı kaynaktan okur."

3. **Backend route guard belirsiz** — v3'te frontend navigation filter kesin (`tD` nav array) ama backend `requireRole` middleware varlığı doğrulanamadı. Potansiyel güvenlik açığı — `pain-points.md`'ye gidecek madde. **How to apply:** v5'te kesinleşecek — backend her endpoint'te rol kontrolü zorunlu.

4. **Şifre sıfırlama** — admin-manuel-reset modeli v3 kodunda mevcut (`POST /auth/forgot-password`) ama UI/endpoint kesişimi bozuk. Hibrit ADR-002 önerimizle uyumlu. **How to apply:** v5'te yeniden tasarım değil, mevcut intent'i düzgün çalıştırma.

5. **Özellik grubu atama — ikili model altyapıda hazır** (`attributes.js:135-138`). v3 DB'sinde hem `category_attribute_groups` hem `product_attribute_groups` tablosu mevcut ama UI sadece ürün atamasını gösteriyor. Kullanıcı kategoriye atamayı açıkça tercih ediyor. **How to apply:** v5 Modül 3 (Menü) MVP'sinde kategori atama UI'ya çıkarılacak; ürün override korunur.

6. **Snapshot semantiği kritik** — v3'te `order_items.product_name` sipariş anında snapshot'lanıyor, raporlar `GROUP BY oi.product_name` ile bu snapshot üzerinden çalışıyor (`reports.js:61,65`). Menü güncellemesi eski siparişleri etkilemiyor. **How to apply:** v5 shared-domain'de Order entity'si snapshot pattern'ı korumalı — sipariş kalemi menü ID'sine değil, fiyat+ad+varyant snapshot'ına bağlı.

7. **Hibrit silme pattern** (`products.js:432-476`) — sipariş geçmişi varsa soft-delete, yoksa hard-delete + görsel dosyası temizliği. **How to apply:** v5 DB ADR-003'te "silinebilir vs. referans tutulan entity'ler" için şablon olarak kullanılacak.

8. **Yazıcı yönlendirme çift mekanizma — sadeleştir** (`printRouting.js:50-57`): v3'te önce `printer_routing` tablosu (kategori bazlı), sonra ürün `printer_target` fallback. UI'da iki mekanizma kafa karıştırıyor, kullanıcı ürün alanının ne işe yaradığını bilmiyor. **How to apply:** v5 MVP'de tek mekanizma = kategori routing. Ürün bazlı override UI v5.1'e.

9. **Garson atama modeli v3'te yok** (Kullanıcı teyit Modül 4): Masa kartındaki garson = aktif siparişi ilk oluşturan, masa garsona kilitli değil. **How to apply:** v5 mobil garson uygulaması geldiğinde bu model yetersiz. v5 MVP'de "masa sorumlu garson" alanı eklenir (değiştirilebilir), admin elle atama/serbest yapar. Data model: `orders.assigned_waiter_id` veya `tables.active_waiter_id` — ADR gerektirir.

10. **Masa birleştirme v3'te yok — MVP'ye alındı** (25 masalı pide/lokanta gerçekliği). v5'te 2+ masa tek adisyon altında birleştirilebilir, sonradan ayrılabilir. **How to apply:** `orders.table_ids[]` (array) yerine `order_tables` junction tablosu. ADR-XXX gerektirir (Phase 1 başında).

11. **"Tek masa = tek aktif sipariş" kuralı** v3'te örtük, v5'te açık invariant olacak. **How to apply:** shared-domain Order entity'sinde invariant; DB'de partial unique index (`WHERE status='open'`). Ek sipariş = aynı adisyona yeni kalem, yeni sipariş değil.

12. **order_type enum = dine_in | takeaway** (`orders.js:53`). Paket servis ayrı akış, masaya bağlanmaz. **How to apply:** v5'te aynı kalır. `takeaway_out_at`, `takeaway_delivered_at` gibi alanlar paket yaşam döngüsü için korunur.

13. **Hedef masa sayısı mekaniği güzel** (`admin.js:2239,2243`): Boş masa düşürme soft-delete, dolu engelleme. **How to apply:** v5'te aynı pattern korunur — runtime "güvenli boyutlandırma" UX'i iyi.

14. **Telefon normalize + unique constraint eksik** (`customers.js:6`, `normalized_phone` var ama unique yok): v3'te aynı telefonla iki müşteri açılabiliyor → Caller ID eşleşmesi belirsizleşiyor. **How to apply:** ADR-003'te `customer_phones.normalized_phone` için `UNIQUE(tenant_id, normalized_phone)` partial index zorunlu.

15. **Müşteri silme yok → anonimize modeli** (kullanıcı kararı): Silme endpoint/UI v5'te olmayacak. KVKK talebi: `full_name='Anonim'`, telefon+adres silinir, `customer_id` + siparişler + `customer_name_snapshot` dokunulmaz. **How to apply:** shared-domain'de `anonymizeCustomer()` fonksiyonu; DB'de veri silme değil üzerine yazma.

16. **Sipariş geçmişi müşteri detayında — kapsam terfi** (charter v5.1 → MVP): Kullanıcı kritik buldu. **How to apply:** `GET /customers/:id/orders` endpoint Phase 2'de planlanacak; müşteri detay sayfasında son N sipariş listesi (tarih, tutar, durum). Yeni ADR gerekli.

17. **Excel import/export — kapsam terfi** (charter v5.1 → MVP): Pilot geçişinde mevcut müşteri tabanını taşımak için kritik. **How to apply:** Phase 2/3 endpoint planına dahil et (`/customers/import` + `/customers/export`). Yeni ADR gerekli.

18. **Print Agent = yazıcı + Caller ID forwarder — tek servis** (kullanıcı kararı): Ayrı Caller ID Bridge servisi yok; restoran PC'sindeki Print Agent her iki sorumluluğu taşır. **How to apply:** ADR-004 Print Agent kapsamına Caller ID forward modülü dahil edilecek. `apps/print-agent` tek Windows servisi.

19. **Caller ID popup polling → Socket.IO emit** (v3 eksikliği düzeltmesi): v3'te `GET /recent` polling (2-3 sn gecikme). v5'te `processIncomingCall()` sonrası `emitToRoom(businessId, 'caller-id', payload)`. **How to apply:** `socket.js`'deki `emitToRoom` fonksiyonu Caller ID için de kullanılır — ayrı socket altyapısı gerekmez.

20. **call_logs 30 gün retention + cron** (kullanıcı kararı): 30 günden eski Caller ID kayıtları otomatik temizlenir. **How to apply:** ADR-003 DB ilkelerine "TTL tabloları ve cleanup cron listesi" bölümü eklenecek. Legacy `incoming_calls` tablosu v5'te kaldırılır.

## Session 3 kapanış özeti (2026-04-22)

**Tamamlanan:**
- Modül 5 — Müşteri (CRM temeli) (tam dolu, v3 koduyla teyit: `customers.js`, `migrations/run.js`, `orders.js`)
- Modül 6 — Caller ID (tam dolu, v3 koduyla teyit: `callerid.js`, `callerIdService.js`, `bridge.js`, `socket.js`)
- 7 yeni mimari sinyal (toplam 20): #14-17 Müşteri, #18-20 Caller ID
- v3 reference ilerleme: %27 → %40 (4/15 → 6/15)
- AskUserQuestion formatıyla interaktif röportaj akışı test edildi (başarılı)

**Kapsam terfileri (ADR bekleyen):**
- Sipariş geçmişi müşteri detayında (charter v5.1 → MVP)
- Excel import/export (charter v5.1 → MVP)

**Açık ADR borçları:**
- ADR-001 Monorepo (Phase 0)
- ADR-002 Auth (Phase 0)
- ADR-003 DB şema (Phase 0 sonu) ← call_logs TTL + cleanup cron eklenecek
- ADR-004 Print Agent mimarisi (Phase 1 başı) ← Caller ID forward modülü kapsama dahil
- ADR-XXX Masa sorumlu garson + birleştirme (Phase 1)
- ADR-XXX Müşteri sipariş geçmişi + Excel I/O kapsam terfi (Phase 1 başı)

**Sıradaki:** Modül 7 — Sipariş (dine-in + paket)

## Session 4 starter prompt — Modül 6 başlangıç

```
[Tarih]. Restoran POS v5 Session 4'e başlıyorum.

Önce bağlamı kur:
1. CLAUDE.md — v3 referans erişimi bölümü
2. .claude/plans/active-plan.md — durum (%33, 5/15)
3. .claude/memory/scratchpad.md — sinyaller #1-17 + Session 3 kapanış
4. docs/v3-reference/modules.md — Modül 5 format referansı

Session 4 görevi: Modül 6 — Caller ID röportajı.
- Modül 4'te UI akışı doldu (popup, Siparişi Aç, son 7 gün); Modül 6 teknik/backend odaklı olacak
- AskUserQuestion formatı (interaktif seçim)
- v3: D:\dev\restoran-pos-v3\server\routes\callerid.js
- Etiketleme kuralı: Kodda tespit / Kullanıcı gözlemi / Doğrulanmamış
```

## Session 2 kapanış özeti (2026-04-22)

**Tamamlanan:**
- Modül 3 — Menü (tam dolu, v3 koduyla teyit: `attributes.js`, `products.js`, `printRouting.js`, `reports.js`)
- Modül 4 — Masa Yönetimi + Salon Bölgeleri (tam dolu, v3 koduyla teyit: `tables.js`, `orders.js`, `admin.js`, `reports.js`)
- 9 yeni mimari sinyal (toplam 13): özellik grubu ikili atama, snapshot semantiği, hibrit silme pattern, yazıcı çift mekanizma, garson atama eksikliği, masa birleştirme, tek masa = tek adisyon kuralı, order_type enum, hedef masa sayısı mekaniği
- v3 reference ilerleme: %13 → %27 (2/15 → 4/15)

**Açık ADR borçları (değişmedi):**
- ADR-001 Monorepo (Phase 0)
- ADR-002 Auth (Phase 0)
- ADR-003 DB şema (Phase 0 sonu)
- ADR-004 Print Agent mimarisi (Phase 1 başı)

**Yeni ADR adayı:**
- Masa sorumlu garson modeli (Modül 4 mimari sinyal #9) + Masa birleştirme veri modeli (sinyal #10) — Phase 1'de shared-domain tasarımıyla birlikte ele alınacak.

**Modül 4'ten çıkan MVP düzeltmeleri:**
- Garson atama modeli eklenir (v3 eksiği)
- Masa birleştirme MVP'ye alındı (v3'te yoktu)
- Tek masa = tek adisyon kuralı yazılı olacak
- Yazdırma sorunları Modül 9'da ele alınacak

**Hâlâ doğrulanmamış (Phase 1'de bakılacak):**
- Aynı masada paralel sipariş mümkün mü (tahminen hayır, test yok)
- Menü modülündeki fiş çıktısında özellik basılıyor mu (Modül 9'da netleşecek)
- Barkod alanının işlevsel bağlantısı

## Session 3 starter prompt — Modül 5 başlangıç

```
[Tarih]. Restoran POS v5 Session 3'e başlıyorum.

Önce bağlamı kur, şu dosyaları sırayla oku:
1. CLAUDE.md — proje anayasası (özellikle "v3 referans erişimi" bölümü)
2. docs/project-charter.md — Kapsam + Phase Roadmap
3. .claude/plans/active-plan.md — aktif durum, Session 3 görevi (%27, 4/15)
4. .claude/memory/scratchpad.md — Session 1-2 kapanış + 13 mimari sinyal + ADR-002 açık kararlar
5. docs/v3-reference/modules.md — Modül 1-4 format referansı

Session 3 görevi: Modül 5 — Müşteri (CRM temel) röportajı (v3 reference görev 2 devam).
- Standart 4 soru (A/B/C/D)
- D bölümü üçlü tasnif (v3 ile aynı / sadeleştirilmiş / v5.1 / non-goal)
- Bağımlılıklar tablo formatında (header + |---|---|)
- v3 erişimi D:\dev\restoran-pos-v3\ — read-only, copy-paste yasak, etiketleme kuralı (Kodda tespit / Kullanıcı gözlemi / Doğrulanmamış)
- Sub-agent yerine direkt Read/Grep (Session 2 öğretisi: sub-agent'ı bekleyemiyoruz)
- Her modül sonrası içeriği göster, kullanıcı onayı bekle (disiplin)

Kod yazma, dosya oluşturma, commit atma yapma. Önce bağlamı kur, özetle, "hazırım" de, kullanıcı onaylayınca Modül 5 A sorusuna geç.

İpucu: Modül 5 sonrası Modül 6 (Caller ID) gelir; Modül 4'te Caller ID UI akışı çoğunlukla doldu (popup + son 7 gün geçmişi + Siparişi Aç) — Modül 6'da detay teknik ve backend odaklı olabilir.
```

## Session 1 kapanış özeti (2026-04-22)

**Tamamlanan:**
- Bootstrap (v4'ten taşıma + yeniden yazımlar — önceki oturumlardan)
- Stratejik kararlar: yazıcı sıfırdan yazılır (ADR-004 Phase 1'e borç) + basit UI prensibi (iki seviye + zero-config)
- HCI checklist güncelleme (Basit UI & Sıfır Yapılandırma bölümü + anti-örnek)
- `simple-first-ui` skill iskeleti (detay Phase 0 sonunda dolacak)
- Modül 1 — Ayarlar (tam dolu)
- Modül 2 — Auth/Login (tam dolu, v3 koduyla teyit edildi)
- v3 erişim kuralları CLAUDE.md'ye eklendi + path consistency
- ADR-004 Phase 1 notu active-plan'a eklendi
- Commit'ler: `b4d308b`, `25e395f`, `259b102`

**Açık ADR borçları:**
- ADR-001 Monorepo (Phase 0)
- ADR-002 Auth — şifre reset hibrit, token süreleri, rol matrisi config (Phase 0)
- ADR-003 DB şema (Phase 0 sonu)
- ADR-004 Print Agent mimarisi (Phase 1 başı)

**Açık kararlar listesi:**
- ADR-002 hibrit şifre reset: admin reset MVP, email endpoint ready-but-disabled, v5.1 flag

**Hâlâ bilinmeyen (Phase 1'de bakılacak):**
- v3 logout davranışı (buton var, akış test edilmedi)
- Oturum timeout
- Backend route guard varlığı (frontend filter kesin, backend belirsiz)

## Session 2 starter prompt — Modül 3 başlangıç

```
[Tarih]. Restoran POS v5 Session 2'ye başlıyorum.

Önce bağlamı kur, şu dosyaları sırayla oku:
1. CLAUDE.md — proje anayasası (özellikle "v3 referans erişimi" bölümü)
2. docs/project-charter.md — Kapsam (v5.0 MVP / v5.1 / v5.2+ / non-goal) + Phase Roadmap
3. .claude/plans/active-plan.md — aktif durum, Session 2 görevi
4. .claude/memory/scratchpad.md — Session 1 kapanış özeti + v3 mimari sinyaller + ADR-002 açık kararlar
5. docs/v3-reference/modules.md — Modül 1-2 tamamlanmış, format referansı

Session 2 görevi: Modül 3 — Menü röportajı (v3 reference görev 2 devam).
- Standart 4 soru (A/B/C/D)
- D bölümü üçlü tasnif (v3 ile aynı / sadeleştirilmiş / v5.1 / non-goal)
- Bağımlılıklar tablo formatında (header + |---|---|)
- v3 erişimi D:\dev\restoran-pos-v3\ — read-only, copy-paste yasak, etiketleme kuralı (Kodda tespit / Kullanıcı gözlemi / Doğrulanmamış)
- Her modül sonrası içeriği göster, kullanıcı onayı bekle (disiplin)

Kod yazma, dosya oluşturma, commit atma yapma. Önce bağlamı kur, özetle, "hazırım" de, kullanıcı onaylayınca Modül 3 A sorusuna geç.
```

## Phase 0 sonunda taşınacaklar

<!-- Bu liste Phase 0 kapanışında decisions.md'ye veya ilgili docs'a taşınır -->

- ADR-001: Monorepo yapısı ve paket isimlendirme
- ADR-002: Auth stratejisi (JWT access + refresh, cookie mi header mı)
- ADR-003: DB şema ilkeleri (`tenant_id` konvansiyonu, id tipi, timestamp tipi)
- ADR-004: Print Agent mimari (cloud pull mı push mı, queue, retry)
- ADR-005: Web UI state management (TanStack Query + Zustand mı, başka mı)
