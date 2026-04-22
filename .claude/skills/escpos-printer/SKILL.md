---
name: escpos-printer
description: Use when integrating 80mm thermal printers (USB or Ethernet) for order tickets, kitchen prints, customer receipts. Covers ESC/POS protocol, Turkish character encoding (CP857), category-based routing, and error recovery.
---

# 80mm Termal Yazıcı Entegrasyonu (ESC/POS)

Restoran POS'unda baskı üç kategoride:
- **Adisyon**: Kasiyer yazıcısı (kasada)
- **Mutfak fişi**: Mutfak yazıcısı (sıcak yemekler, tatlılar)
- **Bar fişi**: Bar yazıcısı (içecekler)

## Donanım tipleri

### USB yazıcılar
- Bağlantı: USB → ana bilgisayar
- Driver: Windows'ta genellikle POS driver veya generic / text only
- Node'dan erişim: `node-thermal-printer` + `node-hid` veya doğrudan raw USB

### Ethernet (Network) yazıcılar
- Bağlantı: LAN kablosu + statik IP veya DHCP reservation
- Port: 9100 (raw print, standart)
- En kararlı — USB driver sorunları yok

## Önerilen paket

`node-thermal-printer` — hem USB hem network destekli, ESC/POS komutlarını soyutlar.

```bash
pnpm add node-thermal-printer
```

## Türkçe karakter desteği (KRİTİK)

Varsayılan ESC/POS CP437 karakter tablosu kullanır — Türkçe yok. `ç ğ ı ö ş ü` düzgün basılmaz.

**Çözüm**: CP857 (Türkçe) character set'e geç.

```typescript
import { ThermalPrinter, PrinterTypes, CharacterSet } from 'node-thermal-printer';

const printer = new ThermalPrinter({
  type: PrinterTypes.EPSON,  // veya STAR
  interface: 'tcp://192.168.1.100:9100',
  characterSet: CharacterSet.PC857_TURKISH,
  removeSpecialCharacters: false,
  lineCharacter: '─',
});
```

Yazıcı modeline göre:
- **Epson**: PrinterTypes.EPSON, CP857 destekler
- **Star**: PrinterTypes.STAR, CP857 destekler
- **Generic Çin modelleri**: PrinterTypes.EPSON genellikle çalışır; test et

## Adisyon şablonu

```typescript
async function printCheck(order: Order, printer: ThermalPrinter) {
  printer.alignCenter();
  printer.bold(true);
  printer.setTextDoubleHeight();
  printer.println(order.branch.name);
  printer.setTextNormal();
  printer.bold(false);
  printer.println(order.branch.address);
  printer.println(`Tel: ${order.branch.phone}`);
  printer.drawLine();

  printer.alignLeft();
  printer.println(`Masa: ${order.table.number}   Pax: ${order.guestCount}`);
  printer.println(`Tarih: ${formatDate(order.openedAt)}`);
  printer.println(`Garson: ${order.waiter.name}`);
  printer.drawLine();

  for (const item of order.items) {
    printer.tableCustom([
      { text: `${item.quantity}x ${item.productName}`, align: 'LEFT', width: 0.65 },
      { text: formatTRY(item.totalPriceKurus), align: 'RIGHT', width: 0.35 },
    ]);

    // Modifier'ları alt satıra (küçük font)
    for (const mod of item.modifiers) {
      printer.println(`  + ${mod.name}`);
    }
  }

  printer.drawLine();
  printer.alignRight();
  printer.bold(true);
  printer.setTextDoubleWidth();
  printer.println(`TOPLAM: ${formatTRY(order.totalKurus)}`);
  printer.setTextNormal();
  printer.bold(false);

  printer.alignCenter();
  printer.println('');
  printer.println('Afiyet olsun');
  printer.println('');

  // QR kod (opsiyonel — müşteri sadakat için)
  if (order.loyaltyQR) {
    printer.alignCenter();
    printer.printQR(order.loyaltyQR, { cellSize: 6 });
  }

  printer.cut();

  try {
    await printer.execute();
  } catch (err) {
    // Kuyruğa al, sonra tekrar dene
    await enqueuePrintJob(order, err);
    throw err;
  }
}
```

## Mutfak fişi (kategoriye göre yönlendirme)

```typescript
async function dispatchOrderToPrinters(order: Order, printers: Map<PrinterId, ThermalPrinter>) {
  // Kategori → yazıcı mapping'i
  const routing = await loadPrinterRouting(order.branchId);
  // {
  //   'sıcak-yemek': 'kitchen-printer-1',
  //   'soğuk-yemek': 'kitchen-printer-1',
  //   'tatlı': 'kitchen-printer-2',
  //   'içecek': 'bar-printer',
  // }

  const grouped = groupItemsByPrinter(order.items, routing);

  for (const [printerId, items] of grouped) {
    const printer = printers.get(printerId);
    if (!printer) continue;

    await printKitchenTicket(printer, {
      tableNumber: order.table.number,
      waiter: order.waiter.name,
      items,
      sentAt: new Date(),
    });
  }
}
```

## Hata kurtarma

Yazıcı hataları:
- Kağıt bitti
- Yazıcı offline (USB çekildi, LAN koptu)
- Yazıcı meşgul (buffer dolu)
- Timeout

### Strategi

```typescript
class PrintQueue {
  private queue: PrintJob[] = [];
  private retryDelays = [1000, 5000, 30_000]; // ms

  async enqueue(job: PrintJob) {
    this.queue.push(job);
    await this.persist(); // SQLite'a kaydet
    this.processNext();
  }

  private async processNext() {
    const job = this.queue[0];
    if (!job) return;

    try {
      await this.tryPrint(job);
      this.queue.shift();
      await this.persist();
    } catch (err) {
      if (job.attempts < this.retryDelays.length) {
        job.attempts++;
        setTimeout(() => this.processNext(), this.retryDelays[job.attempts]);
      } else {
        // Dead letter: kullanıcıya bildir
        this.notifyPrinterDown(job);
      }
    }

    if (this.queue.length > 0) this.processNext();
  }
}
```

### UI geri bildirimi

- Yazıcı durumu her ekranda: `🖨 Kasiyer yazıcı: ✅ Hazır`
- Yazıcı offline ise: `🖨 Mutfak yazıcı: ⚠ Bağlantı yok — kuyrukta 3 fiş var`
- Yeniden bağlanınca kuyruktan otomatik basılır

## Bağlantı keşfi (network yazıcı)

```typescript
import { createSocket } from 'node:dgram';

// Yazıcı SNMP veya mDNS broadcast yapıyorsa dinlenebilir
// Alternatif: config'ten IP al, ping + port 9100 check

async function pingPrinter(ip: string, timeout = 2000): Promise<boolean> {
  const net = await import('node:net');
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const done = (result: boolean) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeout);
    socket.on('connect', () => done(true));
    socket.on('timeout', () => done(false));
    socket.on('error', () => done(false));
    socket.connect(9100, ip);
  });
}
```

## Baskı kalitesi ayarları

```typescript
// Yazıcı başlatma
printer.init();

// Font ayarları
printer.setTextSize(1, 1);       // normal
printer.setTextDoubleHeight();   // başlık
printer.setTextDoubleWidth();    // toplam
printer.bold(true);              // önemli satır

// Çizgi
printer.drawLine();              // tam genişlik
printer.newLine();

// Cut
printer.cut();                   // full cut (varsa)
printer.partialCut();            // partial cut (çoğu modele)

// Drawer (yoksa zararsız)
printer.openCashDrawer();
```

## Test senaryoları

- [ ] Türkçe karakter baskı testi (ç,ğ,ı,ö,ş,ü)
- [ ] 100 satırlık uzun adisyon testi
- [ ] USB yazıcı çekildi → kuyruğa alındı → takıldı → basıldı
- [ ] Network yazıcı offline → 5 sipariş birikti → online → hepsi basıldı
- [ ] Kağıt bitti sensörü → UI uyarı gösterdi
- [ ] Multiple printer concurrency (3 yazıcıya eş zamanlı)
- [ ] Partial cut vs full cut (modele göre)
- [ ] QR kod baskı (loyalty)

## Yazıcı marka/model uyumluluk listesi

Pilot için kararlaştırılan ve test edilen modeller:
- Epson TM-T20III (USB + Ethernet) — referans model
- Xprinter XP-T80A (USB) — uygun fiyatlı
- Bixolon SRP-350plus (Ethernet) — güvenilir
- Star TSP143IIILan (Ethernet) — premium

Test edilmemiş yeni model → `architect` ile test planı, sonra onay.
