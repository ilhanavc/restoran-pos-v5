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
