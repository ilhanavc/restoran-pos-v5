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
 * tam matris sınanır. Emsal: S133'te `OrderScreen` için çıkarılan saf
 * `orderScreenMode` modülü.
 *
 * ⚠️ ORTAK KARAR DAVRANIŞ BİRLİĞİNİ **GARANTİ ETMEZ.** İlk yazımda buraya
 * "iki uygulama tek karardan beslendiği için davranışları ayrışamaz" yazmıştım;
 * güvenlik kapısı karşı örnek buldu (ADR-002 §13.3 Düzeltme 2): web
 * `performRefresh` yanıt gövdesini doğrulamadığı için bozuk bir 2xx gövdesi
 * sınıflandırıcıya **hiç ulaşmıyordu** — promise başarıyla çözülüyor, store'a
 * geçersiz token yazılıyordu. Paylaşılan şey karar; **girdiyi üretmek** her iki
 * tarafın kendi sorumluluğunda. Yeni bir çağıran eklenirse girdi üretimi
 * (ağ hatası yakalama + gövde doğrulama + statü taşıma) birebir kopyalanmalı.
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

  // 🔑 TEK KURAL: oturum YALNIZ sunucu token'ı açıkça reddettiğinde biter.
  //   401 → sunucu token'ı açıkça reddetti.
  //   403 → `AUTH_CSRF_CHECK_FAILED`; her refresh aynı şekilde reddedilir,
  //         oturumu sürdürmek anlamsız.
  // Diğer HER ŞEY (404, 400, 422, 429, 5xx, <400 …) → oturum KORUNUR.
  //
  // ⚠️ İLK SÜRÜM "diğer 4xx → session-ended" diyordu ve KENDİ GEREKÇESİYLE
  // ÇELİŞİYORDU (güvenlik kapısı CONCERN-2, ADR-002 §13.3 Düzeltme):
  // Nginx yanlış route / eksik build → `/auth/refresh` **404** → tüm personel
  // servis ortasında çıkışa zorlanır VE token'ları revoke edilir. Bu, 5xx ve
  // bozuk-gövde için açıkça reddedilen senaryonun birebir aynısı.
  // "Muhafazakâr" taraf yanlış seçilmişti: yıkıcı aksiyon oturumu DÜŞÜRMEKTİR,
  // korumak değil. İstemci hiçbir yetki kararı vermiyor — her istek sunucuda
  // yeniden doğrulanıyor — dolayısıyla `keep-session` fail-safe olandır.
  //
  // 429 da bu yüzden `keep-session`: bugün bu uçta limiter yok (gelmiyor),
  // eklenirse 429 geçici bir durumdur ve doğru cevap yine `keep-session`'dır.
  return status === 401 || status === 403 ? 'session-ended' : 'keep-session';
}
