/**
 * Refresh başarısızlığı sınıflandırması — ADR-002 §13 (Amendment 7).
 *
 * Access token süresi geçince istemci `/auth/refresh` çağırır. O çağrı
 * başarısız olursa **oturum düşürülmeli mi?** sorusunun cevabı buradadır.
 *
 * 🔴 NEDEN SAF BİR MODÜL — gerçek kapsama buraya konabilsin diye.
 * `apps/web`'de `lib/api.ts` için test YOK ve axios mock bağımlılığı
 * (`axios-mock-adapter`/`msw`) da YOK; `apps/mobile` vitest'i yalnız
 * `src/**` + `*.test.ts` topluyor (RN render altyapısı yok). Karar mantığı
 * istemci kodunun içinde kalsa **test edilemezdi**. Burada saf olduğu için
 * tam matris sınanır ve iki uygulama TEK karardan beslendiği için
 * davranışları ayrışamaz. Emsal: S133'te `OrderScreen` için çıkarılan saf
 * `orderScreenMode` modülü.
 *
 * ⚠️ NEDEN VAR — düzeltilen kusur: her iki uygulama da ağ hatasını 401'den
 * AYIRMIYORDU. `performRefresh`'in her hatası aynı `catch`'e düşüyor ve
 * oturumu düşürüyordu → şebeke bir an titrediğinde garson/kasiyer, token'ı
 * sunucuda hâlâ GEÇERLİ olmasına rağmen çıkışa zorlanıyordu.
 */

/** Refresh çağrısının nasıl başarısız olduğu. */
export type RefreshFailure =
  /** Taşıma katmanı: fetch reject, abort, timeout, DNS, bağlantı kopması. */
  | { kind: 'network' }
  /** Sunucu yanıt verdi ama hata statüsüyle. */
  | { kind: 'http'; status: number };

/**
 * `keep-session`: oturumu KORU. İstek başarısız sayılır, kullanıcıya bağlantı
 * hatası gösterilir, ama çıkış YAPILMAZ.
 * `session-ended`: oturum gerçekten bitti. Çıkış + giriş ekranında bilgi.
 */
export type RefreshFailureAction = 'keep-session' | 'session-ended';

/**
 * Tek karar noktası. Gerekçeler ADR-002 §13.3'teki tabloyla birebir.
 */
export function classifyRefreshFailure(
  failure: RefreshFailure,
): RefreshFailureAction {
  if (failure.kind === 'network') {
    // Token'ın geçerliliği hakkında HİÇBİR bilgi yok — sunucuya ulaşılamadı.
    // Oturumu düşürmek kanıtsız ceza olur.
    return 'keep-session';
  }

  const { status } = failure;

  // Sunucu arızası, kimlik sorunu DEĞİL. Token muhtemelen geçerli; 5xx'te
  // tüm personeli çıkışa zorlamak arızayı büyütür.
  if (status >= 500) return 'keep-session';

  // Savunmacı: 4xx'in altındaki bir statü "başarısızlık" değildir, yani
  // çağıran yanlış kurulmuş. Çağıran hatası yüzünden kimseyi çıkışa zorlama.
  if (status < 400) return 'keep-session';

  // 401 → sunucu token'ı açıkça reddetti.
  // 403 → `AUTH_CSRF_CHECK_FAILED` (istemci hatalı kurulmuş); oturumu
  //       sürdürmek anlamsız, her refresh aynı şekilde reddedilir.
  // Diğer 4xx (400, 404, 422 …) → muhafazakâr varsayılan: kontrat beklenmedik,
  //       bilinmeyen durumda oturumu sürdürmek riskli.
  //
  // ⚠️ 429 — BUGÜN `session-ended`, ÇÜNKÜ `/auth/*` uçlarında rate-limit YOK
  // (`routes/auth.ts`: yalnız `/login`'de `loginLimiter` var). 429 bu yüzden
  // beklenmeyen bir durum. Rate-limit işi (açık chip) `/auth/refresh`'e limiter
  // eklerse 429 **geçici** bir duruma dönüşür ve bu satır YENİDEN
  // DEĞERLENDİRİLMELİDİR — o zaman `keep-session` doğru olur (ADR-002 §13.3).
  return 'session-ended';
}
