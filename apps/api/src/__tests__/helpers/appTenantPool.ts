import { Pool } from 'pg';

/**
 * ADR-041 F3 test-harness — uygulamayı prod-sadık şekilde `app_tenant`
 * (NOBYPASSRLS) rolü altında koşturan pg Pool.
 *
 * Bağlantının başlangıç option'ı `-c role=app_tenant` ile rol **connect-time'da**
 * düşürülür — `SET ROLE`'un yarış-güvenli (race-free) hali: rol, bağlantı üzerinde
 * herhangi bir sorgudan ÖNCE uygulanır (pool'un `connect` event'inde async
 * `SET ROLE` çalıştırmanın aksine, ilk sorgu araya giremez). Bağlanan kullanıcı
 * (test/dev'de `postgres` superuser) `app_tenant`'ın üyesi olduğundan SET ROLE
 * serbesttir; rol düşünce oturum NOBYPASSRLS olur → `FORCE ROW LEVEL SECURITY`
 * ısırır (ampirik doğrulandı: context'siz `tables` SELECT = 0 satır).
 *
 * **Neden (F2 dersi — [[feedback_rls_consumer_completeness_audit]]):** entegrasyon
 * testleri app'i superuser ile koşturursa RLS bypass olur → `withTenant`'a
 * sarılmamış bir call-site MASKELENIR (sahte-yeşil). Bu pool ile sarılmamış site
 * 0 satır döndürür → test KIRMIZI → merge öncesi yakalanır. F3'ün birincil
 * güvenlik ağı budur.
 *
 * **Kullanım:** yalnız `buildApp`'e verilen "app pool"u için. Fixture/seed
 * (RLS'li tabloları context'siz yazan, `DELETE FROM tenants` yapan) connection'lar
 * AYRI düz `createPool` (postgres superuser) ile kalır. Yani test iki pool tutar:
 * fixture=superuser, app=app_tenant.
 *
 * Yalnız test/dev içindir — prod'da uygulama zaten `app_tenant` LOGIN rolüyle
 * doğrudan bağlanır (M4 runtime rolü doğrular); bu helper prod'da kullanılmaz.
 */
export function createAppTenantPool(connectionString: string): Pool {
  return new Pool({
    connectionString,
    options: '-c role=app_tenant',
    // Test app-pool'u düşük max: her test dosyası artık İKİ pool açar
    // (fixture=superuser + app=app_tenant); paralel vitest worker'larında toplam
    // bağlantı sayısını sınırlı tutmak için app tarafı küçük (testler dosya-içi
    // sıralı, yüksek eşzamanlılık gerekmez). max_connections baskısını azaltır.
    max: 4,
    idleTimeoutMillis: 10_000,
  });
}
