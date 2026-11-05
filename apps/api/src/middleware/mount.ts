import type { Application, RequestHandler, Router } from 'express';

/**
 * Mount deseni taşıyıcısı (ADR-006 §2 Amendment 2026-11-05).
 *
 * **Sorun.** 5xx log satırında router öneki yoktu. `errorHandler` app
 * seviyesinde çalışıyor ve Express, hata oraya ulaşmadan önce router'dan
 * çıkarken `req.baseUrl`'i restore ediyor → alan `''`. Log `/:orderId/items`
 * basıyordu; bunun `/orders` mu `/kds` mi olduğu belirsizdi (gerçek Express
 * 5.2.1 ile ölçüldü).
 *
 * **Çözüm.** Öneki istekten TÜRETMİYORUZ; `app.use`'a verilen literal deseni
 * kapanışta tutup isteğe yazıyoruz. Desen derleme zamanında sabit.
 *
 * 🔴 **Neden `req.baseUrl` kullanılamaz (yalnız restore yüzünden değil).**
 * `req.baseUrl` şablonu değil EŞLEŞEN METNİ döner. Mount'lar parametreli
 * olabilir — bugün ikisi öyle: `/menu/categories/:id/attribute-groups` ve
 * `/products/:id/attribute-groups` (ADR-012). `baseUrl` okunsa o iki router'ın
 * log satırına **gerçek kategori/ürün UUID'si** girerdi; bu, CLAUDE.md'nin
 * log'a PII yasağına ve `errorHandler`'ın kendi "ham URL log'a girmez"
 * kuralına aykırı olurdu. Desen taşımak bunu **mekanik olarak** imkânsız
 * kılar: `recordMount` isteğe hiç bakmaz, sızdıracak veriyi görmez.
 *
 * ⚠️ Mount deseni **serbest, parametreli olabilir** — log'a desen olarak
 * (`:id`) girer. (Bu dosyadan önce JSDoc "mount'lar parametresiz kalmalı"
 * diyordu; o güvence yanlıştı ve zaten ihlal edilmişti.)
 */
declare global {
  namespace Express {
    interface Request {
      /**
       * `app.use`'a verilen literal mount deseni (ör. `/orders`,
       * `/products/:id/attribute-groups`). `mount()` üzerinden eklenmiş
       * router'larda doludur; app seviyesinde (route eşleşmeden) fırlayan
       * hatalarda `undefined`.
       */
      mountPattern?: string;
    }
  }
}

/** Deseni isteğe yazan ince middleware. İsteğin içeriğine HİÇ bakmaz. */
export function recordMount(pattern: string): RequestHandler {
  return (req, _res, next) => {
    req.mountPattern = pattern;
    next();
  };
}

/**
 * Router'ı deseniyle birlikte mount eder — `app.use(pattern, router)` yerine
 * **tek giriş kapısı**.
 *
 * `app.ts`'deki her router bundan geçmek ZORUNDA: `mount()` atlanarak eklenen
 * bir router'ın 5xx satırı sessizce öneksiz kalır. Bu disiplin bir yorumla
 * değil **testle** tutulur — `app-mount-coverage.test.ts`, yol verilerek
 * yapılan doğrudan kayıt sayısının 0 olduğunu doğrular.
 */
export function mount(app: Application, pattern: string, router: Router): void {
  app.use(pattern, recordMount(pattern), router);
}
