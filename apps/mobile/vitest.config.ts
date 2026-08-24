import { defineConfig } from 'vitest/config';

/**
 * Mobil birim testleri (ADR-039 DoD 23/23a/23b ile geldi).
 *
 * **Kapsam bilinçli olarak SAF mantıkla sınırlıdır** (environment: 'node'):
 * React Native bileşenlerini render eden bir test altyapısı (jest-expo /
 * @testing-library/react-native + native mock'lar) bu depoda YOKTUR ve onu
 * kurmak ADR-039'un kapsamı dışında, ayrı bir karardır (yeni bir test
 * çalıştırıcısı + RN transformer'ı + mock katmanı = kendi bakım yükü).
 *
 * Bu yüzden rol-görünürlüğü gibi kritik kararlar bileşenden AYRI, saf
 * fonksiyonlara çekildi (`store/permissions.ts`, `features/takeaway/payload.ts`)
 * ve testler o fonksiyonları doğrular; bileşen ise o fonksiyonun dışında
 * ikinci bir koşul TAŞIMAZ (tek koruma hattı = tek test noktası).
 *
 * `.expo`/`node_modules` hariç tutulur; RN kaynaklarını import eden dosyalar
 * (ekranlar, sheet'ler) test dosyası içermez ve buraya girmez.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['node_modules', '.expo'],
  },
});
