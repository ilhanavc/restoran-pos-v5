import packageJson from '../package.json' with { type: 'json' };

/**
 * Print Agent binary versiyonu — `package.json` TEK KAYNAK.
 *
 * Boot log'u bu sabiti basar. Gerekçe (S83 + S97 dersleri): dükkan PC'sinde
 * exe elle kopyalanarak güncelleniyor (MSI upgrade YASAK — nssm
 * `AppEnvironmentExtra` siliniyor). Kopyalama sessizce başarısız olursa ya da
 * yanlış dosya kopyalanırsa servis ESKİ binary ile çalışmaya devam eder ve
 * bu hiçbir yerden anlaşılmaz. Boot log'undaki versiyon, cutover'ın tek
 * ucuz kabul kanıtıdır.
 *
 * WiX `Package/@Version` aynı string'i kullanır; ikisi elle senkron tutulur
 * (`version.test.ts` bunu doğrular).
 */
export const VERSION: string = packageJson.version;
