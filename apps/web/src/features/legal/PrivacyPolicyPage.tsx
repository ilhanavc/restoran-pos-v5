/**
 * Gizlilik Politikası — halka açık, giriş GEREKTİRMEYEN sayfa (`/privacy`).
 *
 * ADR-031 Amendment 4 K4: Garson mobil uygulaması App Store + Google Play'e
 * halka açık olarak yayınlanır. Her iki mağaza da "Privacy Policy URL" alanına
 * **anonim erişilebilir** bir adres ister; auth arkasındaki sayfa RED sebebidir.
 * Bu yüzden route `ProtectedRoute` sarmalayıcısının DIŞINDA tanımlanmıştır
 * (bkz. `apps/web/src/router.tsx`, `/login` ile aynı düzey).
 *
 * i18n istisnası (bilinçli, CLAUDE.md directive #4'e not):
 * Bu sayfa kullanıcı arayüzü değil, **format ve ifadesi kilitli tek dilli bir
 * hukuki metindir**. Metnin bütünü KVKK envanterinden (`docs/compliance/
 * kvkk-data-inventory.md`) türetilmiştir ve hukuki anlamı paragraf bütünlüğüne
 * bağlıdır; `t('...')` anahtarlarına bölünmesi metni parçalar, çeviri gerektiren
 * bir ikinci dil de yoktur (v5.0 tek dilli: Türkçe). Bu nedenle metin doğrudan
 * JSX içinde Türkçe sabit olarak yazılmıştır. Uygulamanın geri kalanındaki
 * hardcoded string yasağı AYNEN geçerlidir — bu istisna yalnız bu dosyadır.
 *
 * İçerik kaynağı: `docs/compliance/kvkk-data-inventory.md` (§2 veri sorumlusu /
 * işleyenler, §3 veri kategorileri, §4 amaçlar, §5 saklama, §6 yurt dışı
 * aktarım, §8 ilgili kişi hakları, §9 teknik tedbirler). Envanter değişirse bu
 * sayfa da güncellenir (ADR-031 Amd4 K9: "beyan uydurulmaz, envanterden türetilir").
 */

/**
 * Destek / veri sorumlusuna başvuru e-postası.
 *
 * ADR-031 Amendment 4 K5 uyarınca destek kanalı tek bir e-posta adresidir ve bu
 * adresi **ürün sahibi belirler** ([USER] iş kalemi #5). Aynı adres Play Console
 * "Support email" ve App Store Connect destek alanına da girilecektir.
 * Mağazaya gönderimden önce burası gerçek adresle değiştirilir.
 */
const SUPPORT_EMAIL = 'destek@restoranpos.org';

/** Politikanın en son gözden geçirildiği tarih (metin değişince güncellenir). */
const LAST_UPDATED = '21 Ağustos 2026';

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
      <div className="mt-2 space-y-3 text-sm leading-relaxed text-slate-700">{children}</div>
    </section>
  );
}

export default function PrivacyPolicyPage(): JSX.Element {
  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10">
      <article className="mx-auto max-w-3xl rounded-lg bg-white p-6 shadow-sm sm:p-10">
        <header className="border-b border-slate-200 pb-6">
          <h1 className="text-2xl font-bold text-slate-900">Gizlilik Politikası</h1>
          <p className="mt-2 text-sm text-slate-500">
            Halka açık mağazalardan (App Store, Google Play) indirilen Restoran POS Garson
            mobil uygulaması ve bu uygulamayı kullanan işletme personeli için geçerlidir.
          </p>
          <p className="mt-1 text-sm text-slate-500">Son güncelleme: {LAST_UPDATED}</p>
        </header>

        <Section title="1. Bu uygulama nedir?">
          <p>
            Restoran POS, tek bir restoranın (Dilan Pide) kendi personeli tarafından kullanılan
            dahili bir satış noktası (POS) ve operasyon aracıdır. Garson mobil uygulaması; masa
            durumunu görüntülemek, adisyon açmak, sipariş almak ve mutfağa göndermek için
            kullanılır.
          </p>
          <p>
            Uygulama tüketicilere yönelik bir hizmet sunmaz. Kullanım için işletme tarafından
            oluşturulmuş bir personel hesabı zorunludur; hesabı olmayan bir kişi uygulamada hiçbir
            veri göremez.
          </p>
        </Section>

        <Section title="2. Veri sorumlusu ve iletişim">
          <p>
            Veri sorumlusu, uygulamayı işleten işletmedir: <strong>Dilan Pide</strong> (Mürefte
            Mahallesi, Şarköy / Tekirdağ, Türkiye).
          </p>
          <p>
            Gizlilikle ilgili her türlü soru, bilgi talebi ve veri silme başvurusu için:{' '}
            <a className="font-medium text-amber-700 underline" href={`mailto:${SUPPORT_EMAIL}`}>
              {SUPPORT_EMAIL}
            </a>
          </p>
        </Section>

        <Section title="3. Hangi verileri işliyoruz?">
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong>Personel bilgileri:</strong> kullanıcı adı, görünen ad, varsa e-posta adresi
              ve rol (garson, kasiyer, mutfak, yönetici). Parolalar yalnızca geri döndürülemez
              şekilde şifrelenmiş (hash) olarak saklanır.
            </li>
            <li>
              <strong>Sipariş ve işlem verisi:</strong> açılan adisyonlar, sipariş kalemleri,
              tutarlar, ödemeler, iptal ve ikram kayıtları ile bu işlemleri yapan personelin kaydı.
            </li>
            <li>
              <strong>İşletme müşterilerine ait iletişim bilgileri:</strong> paket servis ve gelen
              arama (Caller ID) akışında kullanılan müşteri adı, telefon numarası ve teslimat
              adresi. Bu veriler uygulamayı indiren kişiye değil, restoranın telefonla sipariş veren
              müşterisine aittir ve yalnızca siparişin hazırlanıp teslim edilmesi için işlenir.
            </li>
            <li>
              <strong>Teknik kayıtlar:</strong> oturum güvenliği için IP adresi ve cihaz/tarayıcı
              bilgisi, hata ve sistem günlükleri, işlem denetim kayıtları.
            </li>
          </ul>
          <p>
            Konum verisi, kamera, mikrofon, rehber, fotoğraflar veya sağlık benzeri özel nitelikli
            veriler <strong>toplanmaz</strong>.
          </p>
        </Section>

        <Section title="4. Verileri neden işliyoruz?">
          <ul className="list-disc space-y-2 pl-5">
            <li>Siparişin alınması, hazırlanması ve teslim edilmesi (sözleşmenin ifası).</li>
            <li>Personelin kimliğinin doğrulanması ve yetkilendirilmesi.</li>
            <li>
              Muhasebe/işletme kayıtlarının tutulması ve işlemlerin izlenebilirliği (denetim
              kaydı).
            </li>
            <li>Sistem güvenliğinin sağlanması ve kötüye kullanımın tespiti.</li>
          </ul>
        </Section>

        <Section title="5. Üçüncü taraflarla paylaşım, reklam ve izleme">
          <p>
            Verileriniz <strong>üçüncü taraflarla paylaşılmaz, satılmaz veya kiralanmaz.</strong>{' '}
            Veriler yalnızca işletme adına kiralanan bulut sunucusunda işlenir.
          </p>
          <p>
            Uygulamada <strong>reklam gösterilmez</strong>, üçüncü taraf reklam ağı,{' '}
            <strong>analitik veya izleme (tracking) aracı kullanılmaz</strong> ve uygulama içi satın
            alma bulunmaz. Kullanıcılar reklam amacıyla profillenmez.
          </p>
        </Section>

        <Section title="6. Veriler nerede saklanır ve nasıl korunur?">
          <p>
            Veriler, Hetzner Online GmbH'nin <strong>Almanya (Falkenstein)</strong> konumundaki
            sunucularında barındırılan bir PostgreSQL veritabanında saklanır. Bu, kişisel verinin
            yurt dışına aktarılması anlamına gelir ve KVKK kapsamında bu şekilde beyan edilir.
          </p>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              Uygulama ile sunucu arasındaki tüm trafik <strong>HTTPS/TLS ile şifrelenir</strong>.
            </li>
            <li>Veritabanı yalnızca sunucunun kendi içinden erişilebilir, internete kapalıdır.</li>
            <li>Parolalar bcrypt ile hash'lenir; düz parola hiçbir yerde saklanmaz.</li>
            <li>
              Yedekler şifrelenerek yine Almanya'daki bir yedek deposunda tutulur; sunucuda güvenlik
              duvarı ve yetkisiz giriş denemelerine karşı koruma etkindir.
            </li>
            <li>
              Garson, yalnızca kendi hazırladığı paket servis siparişine iliştirilen müşteri
              adı/telefonunu görebilir. Müşteri veritabanının tamamına (arama, adres, sipariş
              geçmişi) ve düzenleme işlemlerine yalnızca yönetici ve kasiyer rolleri erişebilir;
              mutfak rolü müşteri iletişim bilgisine hiç erişemez.
            </li>
          </ul>
        </Section>

        <Section title="7. Ne kadar süre saklanır?">
          <ul className="list-disc space-y-2 pl-5">
            <li>Gelen arama kayıtları (Caller ID telefon numarası): 30 gün sonra silinir.</li>
            <li>Yazıcıya gönderilen fiş içerikleri: tamamlanan işlerde 30 gün sonra silinir.</li>
            <li>İşlem denetim kayıtları: 2 yıl.</li>
            <li>
              Müşteri kayıtları ve sipariş geçmişi: işletme kaydı olarak, silme talebi gelene kadar
              saklanır.
            </li>
          </ul>
        </Section>

        <Section title="8. Haklarınız ve veri silme talebi">
          <p>
            KVKK'nın 11. maddesi uyarınca; kişisel verinizin işlenip işlenmediğini öğrenme, bilgi
            talep etme, düzeltilmesini, silinmesini veya yok edilmesini isteme ve işlenmesine itiraz
            etme haklarına sahipsiniz.
          </p>
          <p>
            Bu haklarınızı kullanmak, özellikle kayıtlarımızdaki adınızın, telefon numaranızın ve
            adresinizin <strong>silinmesini</strong> talep etmek için{' '}
            <a className="font-medium text-amber-700 underline" href={`mailto:${SUPPORT_EMAIL}`}>
              {SUPPORT_EMAIL}
            </a>{' '}
            adresine yazmanız yeterlidir. Talepler en kısa sürede, her hâlükârda mevzuatta öngörülen
            süre içinde sonuçlandırılır.
          </p>
          <p>
            Personel hesabınızın silinmesini istiyorsanız işletme yöneticinize başvurabilir veya
            aynı adrese yazabilirsiniz.
          </p>
        </Section>

        <Section title="9. Çocuklara yönelik kullanım">
          <p>
            Uygulama yalnızca işletme personelinin kullanımına yöneliktir ve çocuklara yönelik
            değildir; çocuklardan bilerek veri toplanmaz.
          </p>
        </Section>

        <Section title="10. Bu politikadaki değişiklikler">
          <p>
            Politika güncellendiğinde bu sayfada yayımlanır ve yukarıdaki "Son güncelleme" tarihi
            değiştirilir.
          </p>
        </Section>

        <footer className="mt-10 border-t border-slate-200 pt-6 text-xs text-slate-500">
          Restoran POS · Dilan Pide · İletişim:{' '}
          <a className="underline" href={`mailto:${SUPPORT_EMAIL}`}>
            {SUPPORT_EMAIL}
          </a>
        </footer>
      </article>
    </main>
  );
}
