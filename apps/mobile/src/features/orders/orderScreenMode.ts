/**
 * Sipariş ekranının KİP mantığı — ADR-039 Amendment 4 (Dilim B).
 *
 * `OrderScreen` iki kipte açılır: masa siparişi (`dine_in`, masa kimliğiyle) ve
 * mevcut paket siparişi (`takeaway`, sipariş kimliğiyle). Web'de bu desen zaten
 * canlıdır (`apps/web/src/features/orders/OrderScreenPage.tsx:72-90` —
 * `?orderId=<uuid>` düzenleme kipi); bu modül onun mobil karşılığıdır.
 *
 * **Neden ayrı, saf bir dosya:** `apps/mobile`'da RN bileşen/render testi
 * altyapısı YOK (`vitest.config.ts` → `environment: 'node'`, yalnız
 * `src/**\/*.test.ts`). Yerleşik desen saf fonksiyon testidir
 * (`features/kitchen/takeaway.ts`, `batches.ts`). Bu yüzden "hangi kipte hangi
 * aksiyon görünür", "hangi önbellek anahtarı kullanılır", "sipariş oluşturma
 * yolu açık mı" kararları ekranın içine gömülmez; buradan test edilir. Ekran
 * yalnız bu fonksiyonların çıktısını uygular ve **ikinci bir kural koymaz.**
 *
 * ADR-039 Amd4 K6'nın negatif kontrolü (`POST /orders` paket kipinde ASLA
 * çağrılmaz) `canCreateOrder` üzerinden bu modülün testinde yaşar — yanlış
 * tetiklenmesi sahipsiz/yinelenmiş sipariş üretir, yani veri bütünlüğü sınıfı
 * bir risktir.
 */

/**
 * Sipariş ekranının açılış kipi — ADR-039 Amd4 K1.
 *
 * **Açık `mode` discriminant'ı bilinçli bir seçimdir.** Discriminant'sız
 * `{ tableId: string } | { orderId: string }` biçimi reddedildi: o biçimde
 * mevcut çağrı noktaları değişmeden derlenir, yani derleyici hiçbir çağrı yerini
 * gözden geçirmeye zorlamaz. Canlı sipariş akışına dokunan bir değişiklikte
 * tam olarak bunu istiyoruz. Açık discriminant ayrıca "ikisi de verilmiş" hâlini
 * tip seviyesinde imkânsız kılar.
 *
 * Değerler sunucu sözleşmesinin `order_type` sözlüğüyle aynıdır (ADR-017).
 */
export type OrderScreenMode =
  | { mode: 'dine_in'; tableId: string }
  | {
      mode: 'takeaway';
      orderId: string;
      /**
       * Başlık altındaki müşteri adı — yalnız GÖRÜNTÜ etiketi (ADR-039 Amd4 K4).
       *
       * Neden navigasyon parametresi: müşteri adını sunucudan çekmenin yolu
       * `GET /customers/:id`, ama o uç `admin|cashier|waiter` ile korunuyor ve
       * **`kitchen` rolü yok** (`apps/api/src/routes/customers/index.ts:344-348`).
       * Amd3 K1 bu ekranı aşçıya da açtığı için web'in `useCustomer` deseni
       * olduğu gibi portlanamaz (403). KDS kartı bu adı zaten taşıyor ve KDS
       * `kitchen`'a açık → yeni endpoint, sunucu değişikliği ve yeni PII yüzeyi
       * olmadan web paritesi sağlanır.
       *
       * ⚠️ Amd3 K3 ile çelişmez: orada reddedilen şey snapshot'ı navigasyon
       * HEDEFİ yapmaktı (masa kodu snapshot'ıyla masa bulmak → yanlış masanın
       * siparişi açılır). Burada hedef otoriter `orderId`; bu alan hiçbir veri
       * okuma/yazma kararına girmez. Bayatlarsa sonuç yalnız eski bir başlıktır.
       */
      customerName: string | null;
    };

/**
 * Aktif sipariş sorgusunun önbellek anahtarı (ADR-039 Amd4 K2).
 *
 * **Tek üretim noktası.** Anahtar ekranın içinde dört ayrı yerde elle
 * yazılıyordu; kip eklenince iki ayrı anahtar listesinin zamanla ayrışması
 * kaçınılmazdı (biri güncellenir, öteki unutulur → sessizce bayat önbellek).
 */
export function activeOrderQueryKey(
  target: OrderScreenMode,
): readonly unknown[] {
  return target.mode === 'dine_in'
    ? ['orders', 'by-table', target.tableId, 'active']
    : ['orders', 'by-id', target.orderId, 'active'];
}

/**
 * Bu kipte sipariş OLUŞTURULABİLİR mi? (ADR-039 Amd4 K6)
 *
 * Yalnız masa kipinde. Paket kipinde ekran her zaman **var olan** bir siparişle
 * açılır; tek yol `addOrderItems` + staged-edit commit'tir. Paket siparişi
 * oluşturma tek yerde kalır: `TakeawayOrderScreen` sihirbazı (ADR-039 Amd1).
 */
export function canCreateOrder(target: OrderScreenMode): boolean {
  return target.mode === 'dine_in';
}

/**
 * Masa-bağlamlı aksiyonlar (masa 3-nokta menüsü → ödeme/ikram/iptal/birleştir)
 * render edilir mi? (ADR-039 Amd4 K5)
 *
 * Paket siparişinin masası yoktur; bu aksiyonlar masa nesnesi ve masa etiketi
 * üzerine kuruludur. Aşama yönetimi de buraya TAŞINMAZ — o, ADR-039 Amd2'nin
 * "Paket" sekmesi kartında tek yerde kalır (K7).
 */
export function showsTableActions(target: OrderScreenMode): boolean {
  return target.mode === 'dine_in';
}

/**
 * ADR-035 "Ürünü Başka Masaya Taşı" bu kipte kullanılabilir mi?
 *
 * Paket kipinde hayır: taşıma kaynak masa kimliği ister, paket siparişinin
 * kaynak masası yoktur. **Bu web paritesidir, mobil-özel bir kısıtlama değil:**
 * web de aynı kuralı uygular (`OrderScreenPage.tsx:352` →
 * `canMoveItemRole && !isTakeaway`).
 *
 * Rol denetimiyle (`useCanMoveItem`) birlikte kullanılır; ikisi de geçmelidir.
 */
export function canMoveItemInMode(target: OrderScreenMode): boolean {
  return target.mode === 'dine_in';
}

/**
 * Ekran masa nesnesini masa listesinden çözer mi? (ADR-039 Amd4 K5)
 *
 * Bunun tek tüketicisi "masa bulunamadı" guard'ıdır. Paket kipinde masa
 * aranmadığı için o guard **ASLA** tetiklenmemelidir — aksi hâlde her paket
 * siparişi hata ekranında açılır. Gözden kaçması en muhtemel dal olduğu için
 * ayrı bir yüklemle isimlendirildi.
 */
export function resolvesTable(target: OrderScreenMode): boolean {
  return target.mode === 'dine_in';
}
