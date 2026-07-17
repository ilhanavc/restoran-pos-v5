# HCI Checklist İstisnaları

> `docs/hci/pos-checklist.md` kurallarından **bilinçli** sapmaların kaydı. Her giriş: hangi kural, neden sapıldı, kaynak ADR/PR, gözden geçirme koşulu. `hci-reviewer` bu dosyayı istisna-kaynağı olarak okur; burada kayıtlı bir sapma yeni PR'larda blocker sayılmaz (kapsamı değişmedikçe).

## 1. Masalar header bağlantı-noktası — "yalnız ikon" istisnası (bağlıyken)

- **Kural:** pos-checklist "İkon + metin kombinasyonu — yalnız ikon yasak" (yeni garson ikonu tanımayabilir).
- **Sapma:** Bağlantı-durumu göstergesi **bağlıyken yalnız yeşil nokta** gösterir (metinsiz); bağlanıyor/kopukken noktanın yanına metin etiketi ("Bağlanıyor…" / "Sunucu bağlantısı yok") eklenir.
- **Gerekçe:** Rush-hour minimalizm kuralıyla çatışma bilinçli çözüldü — normal durumda kalıcı "Bağlı" etiketi görsel gürültü üretir ve kart içeriği zaten canlıdır; garsonun **aksiyon alması gereken** anormal durumlar iki kanal (renk + metin) taşır. Erişilebilirlik: nokta her durumda `accessibilityLabel` taşır; `disconnected` geçişi ekran-okuyucuya ayrıca duyurulur (`AccessibilityInfo.announceForAccessibility`).
- **Kaynak:** ADR-026 Amendment 2 K1 (2026-07-17, S98) + hci-reviewer gate raporu (PR #388).
- **Gözden geçirme koşulu:** Pilot geri bildiriminde garsonlar yeşil noktanın anlamını sormaya başlarsa, ilk açılışta 1-2 sn geçici "Bağlı" etiketi (sonra nokta-only) değerlendirilir.
