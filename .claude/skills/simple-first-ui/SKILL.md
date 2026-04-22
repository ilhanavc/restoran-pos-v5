# Skill: simple-first-ui

> Detaylı tasarım rehberi — her admin/ayar ekranında referans al.
> Gate versiyonu `docs/hci/pos-checklist.md` → "Basit UI & Sıfır Yapılandırma" bölümünde.

## İki Prensip

**Prensip A — İki seviye ayarlar**
Her ayar formu iki katman taşır:
- **Basit mod (varsayılan):** Günlük kullanımda lazım olan minimum. Örnek — Yazıcı satırı: `Mutfak yazıcısı: ✓ Çalışıyor [Test Et]`. Teknik detay görünmez.
- **Gelişmiş mod:** "Gelişmiş ▾" butonu açılınca görünür. IP, port, protokol, encoding, queue ayarları, flag'ler burada.

**Prensip B — Zero-config ilk kurulum**
İlk kurulumda otomatik keşif zorunlu. Kullanıcı adres/protokol girmez:
- Yazıcılar: LAN taraması → bulunanlar listelenir → "hangisi mutfak/kasa/bar?" radio → bitti
- Cihazlar: benzer keşif pattern'i

## Uygulama Kapsamı

v5.0 MVP'deki tüm admin ekranları: Ayarlar (işletme, kullanıcı, yazıcı), Menü editörü, Salon bölgesi editörü, Kullanıcı yönetimi.

## Tasarım Soruları (her ekran için sor)

1. "Bu ekrandaki hangi bilgi günlük kullanımda hiç değişmez?" → Gelişmiş mod'a taşı
2. "Kullanıcı bu değeri kendinmi girmeli yoksa sistem bulabilir mi?" → Keşif akışı ekle
3. "İlk kurulumda bu adım atlanabilir mi?" → Opsiyonel yap veya akıllı default koy

## Anti-Örnekler (v3'ten)

- Yazıcı detayında 4 sekme (Genel / Tercihler / Önizleme / Gelişmiş) → aşırı karmaşık
- "Fiziksel cihaz seçimi" dropdown'ı ilk ekranda → kullanıcı ne seçeceğini bilmiyor
- IP:port manuel giriş → hata kaynağı, zero-config ile ortadan kalkar
- "StoreBridge aktif değil ya da yapılandırılmamış" uyarısı → teknik jargon, kullanıcı anlamıyor

## TODO (Phase 0 Görev 2 bittikten sonra doldur)

- [ ] Yazıcı basit mod şablonu — gerçek Figma/mockup
- [ ] Zero-config LAN tarama akış diyagramı
- [ ] v3 pain-points.md'den gelen anti-örneklerin tam listesi
- [ ] Kullanıcı yönetimi basit mod örneği
- [ ] Menü editörü basit mod örneği
