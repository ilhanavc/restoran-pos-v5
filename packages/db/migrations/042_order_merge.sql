-- 042_order_merge.sql
-- ADR-029 "Adisyon Birleştir" — merge orders backend şeması.
-- ADR-003 forward-only: no down migration.
--
-- Bu migration TEK transaction'da güvenle çalışır (fresh CI + incremental prod):
-- 'merged' enum değeri eklenir AMA aynı transaction içinde HİÇBİR YERDE
-- KULLANILMAZ. PostgreSQL, önceden var olan bir enum'a ADD VALUE ile eklenen
-- değerin aynı tx'te kullanılmasını reddeder ("unsafe use of new value ...
-- must be committed before they can be used"; canlı PG 17'de doğrulandı) VE
-- node-pg-migrate v7 default `up` tüm pending migration'ları TEK tx'e sarar.
-- Çözüm: aşağıdaki partial index predicate 'merged'i ADIYLA REFERANS ETMEZ —
-- aktif (terminal-olmayan) statülerin BEYAZ LİSTESİni kullanır; 'merged' liste
-- dışı kaldığı için otomatik hariç tutulur. Böylece yeni değere dokunmadan
-- masayı bloke etmesi engellenir. (blacklist NOT IN (...,'merged') olsaydı
-- 'merged'i referans edip aynı tx'te 55P04 verirdi.)

-- 'merged' = kaynak sipariş başka bir dolu masanın adisyonuna birleştirilince
-- aldığı yeni TERMİNAL durum (cancelled/void değil → iptal/void anomali
-- raporları temiz kalır).
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'merged' AFTER 'void';

-- Kaynak siparişin absorbe edildiği hedef siparişe forensic iz + idempotency.
-- Composite FK orders_id_tenant_id_key (id, tenant_id) UNIQUE'ine bağlanır
-- (order_items → orders(id, tenant_id) presedenti ile aynı).
ALTER TABLE orders
  ADD COLUMN merged_into_order_id UUID NULL;

ALTER TABLE orders
  ADD CONSTRAINT orders_merged_into_fk
  FOREIGN KEY (merged_into_order_id, tenant_id)
  REFERENCES orders (id, tenant_id);

COMMENT ON COLUMN orders.merged_into_order_id IS
  'ADR-029: kaynak sipariş başka adisyona birleştirilince (status=merged) hedef sipariş id. Forensic iz + idempotency. NULL = birleştirilmemiş.';

-- KRİTİK: partial unique index (masada tek aktif sipariş invariant'ı) 'merged'
-- terminal siparişi masayı bloke etmemeli. Mevcut predicate (041) blacklist:
--   WHERE status NOT IN ('paid','cancelled','void')
-- 'merged'i eklemek için blacklist'e yazmak yerine (55P04 riski) AKTİF statüleri
-- beyaz-listeler — 'paid','cancelled','void','merged' hepsi liste-dışı = terminal.
-- (open/sent_to_kitchen/partially_served/served/billed = aktif set, mevcut
-- blacklist ile birebir aynı küme; yeni aktif statü eklenirse burası güncellenir.)
DROP INDEX orders_tenant_table_open_uq;

CREATE UNIQUE INDEX orders_tenant_table_open_uq
  ON orders (tenant_id, table_id)
  WHERE status IN ('open', 'sent_to_kitchen', 'partially_served', 'served', 'billed');
