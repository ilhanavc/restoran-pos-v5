import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * T2 — mount KAPSAM testi (ADR-006 §2 Amendment 2026-11-05).
 *
 * 5xx log satırının tam önekli basması, her router'ın `mount()` üzerinden
 * eklenmesine bağlı. `mount()` atlanarak eklenen bir router sessizce öneksiz
 * kalır — hata vermez, log'da fark edilmez. Bu test o sessizliği kırmızıya
 * çevirir, böylece garanti bir yoruma değil **teste** dayanır.
 *
 * Neden kaynak taraması: öneki runtime'dan okuyarak doğrulamak her router için
 * ayrı bir 500 senaryosu kurmak demekti (20 router). Kaynak taraması kapsamı
 * tek testte verir. Davranışın kendisi T1'de (`errorHandler.test.ts`) gerçek
 * Express üzerinden doğrulanıyor — ikisi birlikte çalışır.
 *
 * ⚠️ Tarama YORUMLARI AYIKLAR. Bu dosya yazılırken `app.ts`'e eklenen bir
 * açıklama yorumu, içinde örnek olarak geçen çağrı kalıbı yüzünden taramayı
 * kandırdı. Yorum ayıklanmazsa test kendi dokümantasyonundan kırmızı verir.
 */

const APP_TS = fileURLToPath(new URL('../app.ts', import.meta.url));

/** Blok ve satır yorumlarını söker — kalan metin yalnız koddur. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

const code = stripComments(readFileSync(APP_TS, 'utf8'));

describe('app.ts — mount() kapsamı', () => {
  it('yol verilerek yapılan doğrudan router kaydı YOK', () => {
    // `app.use(errorHandler)` ve `app.use(helmet())` gibi yolsuz çağrılar
    // kapsam dışı — aranan şey ilk argümanı path literali olan çağrılar.
    const direct = [...code.matchAll(/app\.use\(\s*'([^']+)'/g)].map((m) => m[1]);
    expect(direct, `mount() atlanmış: ${direct.join(', ')}`).toEqual([]);
  });

  it('mount() ile kayıtlı router sayısı 20', () => {
    // Sayı bilinçli olarak sabit: yeni bir router eklenince bu test kırılır ve
    // ekleyen kişi mount() kullandığını teyit etmiş olur. Sayıyı güncellemek
    // bilinçli bir adım olmalı, sessiz bir artış değil.
    const mounted = [...code.matchAll(/mount\(\s*app,\s*'([^']+)'/g)].map((m) => m[1]);
    expect(mounted).toHaveLength(20);
  });

  it('parametreli mount desenleri hâlâ kayıtlı (PII vakasının kaynağı)', () => {
    // Bu iki mount, `req.baseUrl` çözümünün neden reddedildiğinin kanıtı:
    // baseUrl okunsa log'a gerçek UUID girerdi. Kaybolurlarsa amendment'ın
    // gerekçesi de kaybolur — o yüzden açıkça sınanıyorlar.
    const mounted = [...code.matchAll(/mount\(\s*app,\s*'([^']+)'/g)].map((m) => m[1]);
    expect(mounted).toContain('/menu/categories/:id/attribute-groups');
    expect(mounted).toContain('/products/:id/attribute-groups');
  });

  it('errorHandler app seviyesinde ve mount() kullanmıyor', () => {
    // errorHandler bir router değil; yol almaz ve almamalı.
    expect(code).toMatch(/app\.use\(errorHandler\)/);
    expect(code).not.toMatch(/mount\(\s*app,\s*'[^']*',\s*errorHandler/);
  });
});
