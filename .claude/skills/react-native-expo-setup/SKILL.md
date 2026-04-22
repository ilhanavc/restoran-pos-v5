---
name: react-native-expo-setup
description: Use when setting up or configuring the mobile app (apps/mobile). Covers Expo SDK 53+ with dev builds (not Expo Go), monorepo integration, native modules for LAN discovery and printer bridge, and iOS/Android build pipeline.
---

# React Native + Expo Kurulumu

Garson mobil uygulaması için. Monorepo içinde, paylaşılan paketleri kullanarak, iOS + Android tek kod.

## Expo Go vs Dev Client

**Expo Go kullanmıyoruz.** Çünkü:
- Native modüller var: mDNS discovery, socket.io-client native bridge, lokal SQLite
- Custom config gerek
- Production için zaten kendi build almamız lazım

**Dev Client** kullanıyoruz:
- `expo-dev-client` ile custom Expo build
- Native modülleri destekler
- OTA update hâlâ destekli (Expo Updates)

## Monorepo entegrasyonu

pnpm workspace + Expo = dikkat gerektiren konfigürasyon. Metro bundler symlink'leri sevmez.

### package.json (mobile app)

```json
{
  "name": "mobile",
  "version": "0.1.0",
  "main": "expo-router/entry",
  "scripts": {
    "start": "expo start --dev-client",
    "ios": "expo run:ios",
    "android": "expo run:android",
    "build:ios": "eas build --platform ios",
    "build:android": "eas build --platform android"
  },
  "dependencies": {
    "@restoran-pos/domain": "workspace:*",
    "@restoran-pos/api-client": "workspace:*",
    "@restoran-pos/ui-core": "workspace:*",
    "expo": "~53.0.0",
    "expo-router": "~4.0.0",
    "expo-sqlite": "~15.0.0",
    "expo-dev-client": "~5.0.0",
    "expo-updates": "~0.26.0",
    "react": "19.0.0",
    "react-native": "0.76.0",
    "socket.io-client": "^4.8.0",
    "zustand": "^5.0.0",
    "react-native-mdns": "workspace:*"
  }
}
```

### metro.config.js

```javascript
const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// Watch monorepo packages
config.watchFolders = [workspaceRoot];

// Resolver: hoist duplicate dependencies
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// pnpm symlink resolution
config.resolver.disableHierarchicalLookup = true;
config.resolver.unstable_enableSymlinks = true;
config.resolver.unstable_enablePackageExports = true;

module.exports = config;
```

### .npmrc

```
node-linker=hoisted
public-hoist-pattern[]=*
```

pnpm'in default symlink yapısı Expo/Metro ile sorun çıkarıyor. Hoisted node_modules daha uyumlu.

## app.json / app.config.ts

```typescript
// app.config.ts
export default {
  expo: {
    name: 'Restoran POS - Garson',
    slug: 'restoran-pos-waiter',
    version: '0.1.0',
    orientation: 'landscape',
    icon: './assets/icon.png',
    scheme: 'restoranpos',
    userInterfaceStyle: 'automatic',
    ios: {
      supportsTablet: true,
      bundleIdentifier: 'com.ornek.restoranpos.waiter',
      infoPlist: {
        NSLocalNetworkUsageDescription: 'Ana bilgisayara bağlanmak için yerel ağa erişim gerekli',
        NSBonjourServices: ['_restoranpos._tcp'],
      },
    },
    android: {
      package: 'com.ornek.restoranpos.waiter',
      adaptiveIcon: {
        foregroundImage: './assets/adaptive-icon.png',
        backgroundColor: '#ffffff',
      },
    },
    plugins: [
      'expo-router',
      'expo-sqlite',
      [
        'expo-build-properties',
        {
          ios: { deploymentTarget: '15.1' },
          android: { minSdkVersion: 26 },
        },
      ],
    ],
    updates: {
      url: 'https://u.expo.dev/YOUR-PROJECT-ID',
    },
    runtimeVersion: {
      policy: 'fingerprint',
    },
    extra: {
      eas: {
        projectId: 'YOUR-PROJECT-ID',
      },
    },
  },
};
```

## LAN discovery (ana bilgisayar bul)

Garson telefonu, restoranın WiFi'ına bağlandığında ana bilgisayarı otomatik bulmalı.

### mDNS / Bonjour

Ana bilgisayar `_restoranpos._tcp` servisini yayınlar:

```typescript
// apps/desktop/src/main/mdns.ts
import bonjour from 'bonjour-service';

const service = new bonjour().publish({
  name: 'Restoran POS Ana Bilgisayar',
  type: 'restoranpos',
  port: 3001,
  txt: {
    branchId: branch.id,
    version: '1.0.0',
  },
});
```

Mobilde keşif:

```typescript
// apps/mobile/src/lib/discovery.ts
import Zeroconf from 'react-native-zeroconf';

const zeroconf = new Zeroconf();

export async function discoverMainComputer(): Promise<{ host: string; port: number } | null> {
  return new Promise((resolve) => {
    zeroconf.scan('restoranpos', 'tcp', 'local.');

    const timeout = setTimeout(() => {
      zeroconf.stop();
      resolve(null);
    }, 5000);

    zeroconf.on('resolved', (service) => {
      clearTimeout(timeout);
      zeroconf.stop();
      resolve({ host: service.host, port: service.port });
    });
  });
}
```

## Auth — PIN based

Garson girişi kullanıcı adı/şifre değil, **PIN** ile hızlı.

```typescript
// Garson sisteme atanmış 4-6 haneli PIN girer
const { user, token } = await api.post('/auth/waiter-pin', {
  branchId: discoveredBranchId,
  pin: '1234',
});

// Token secure storage'a
import * as SecureStore from 'expo-secure-store';
await SecureStore.setItemAsync('auth_token', token);
```

## Offline-first mobile

Mobil de yerel SQLite tutabilir (expo-sqlite):

```typescript
import * as SQLite from 'expo-sqlite';

const db = await SQLite.openDatabaseAsync('waiter-local.db');

// Offline açık siparişler, menü cache
await db.execAsync(`
  CREATE TABLE IF NOT EXISTS menu_cache (
    id TEXT PRIMARY KEY,
    product TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`);
```

Ana bilgisayar erişilemediğinde de sipariş almaya devam — bağlantı dönünce sync.

## Realtime (WebSocket)

```typescript
import { io } from 'socket.io-client';

const socket = io(`http://${mainComputer.host}:${mainComputer.port}`, {
  transports: ['websocket'],
  reconnection: true,
  auth: { token },
});

socket.on('order:new', (order) => {
  // Başka garsonun aldığı sipariş — UI güncelle
});

socket.on('table:status-changed', (data) => {
  // Masa durumu değişti
});
```

## UI

`apps/mobile/src/` yapı:
```
app/                    # expo-router routes
  (auth)/
    login.tsx
  (tabs)/
    tables.tsx
    orders.tsx
    profile.tsx
  order/[id].tsx
components/             # shared from packages/ui-core veya yerel
lib/                    # api, discovery, socket
stores/                 # zustand global state
```

Component library: `@restoran-pos/ui-core` paketi React Native + React Web için çift target (react-native-web).

## Build (EAS)

`eas.json`:
```json
{
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal"
    },
    "preview": {
      "distribution": "internal",
      "ios": { "simulator": true }
    },
    "production": {
      "autoIncrement": true
    }
  },
  "submit": {
    "production": {}
  }
}
```

Komut:
```bash
eas build --platform ios --profile preview
eas build --platform android --profile preview
```

Pilot için TestFlight (iOS) + Google Play Internal Testing.

## Update stratejisi (OTA)

- Native kod değişiklikleri → yeni binary build + store submission (iOS 1-7 gün review)
- JS/TS değişiklikleri → `eas update` ile OTA (anlık)
- Config değişiklikleri → OTA veya remote config

## Cihaz uyumluluk

Minimum:
- iOS 15.1+ (2021+ iPhone, iPad)
- Android 8.0+ (API 26+, 2017+ cihazlar)

Pilot için önerilen:
- iPhone SE 2020+, iPad mini 6+
- Android: Samsung A serisi, Xiaomi Redmi 10+

Düşük spec cihazlarda sorunsuz çalışma kritik — performance bütçelerini zayıf cihazda ölç.

## Test

- **Unit**: Vitest, pure functions
- **Component**: React Native Testing Library
- **E2E**: Detox (iOS simulator + Android emulator)
- **Visual**: Chromatic veya Percy snapshot

## Bilinen tuzaklar

- **Metro cache**: `expo start --clear` bazen tek çözüm
- **Pod install** (iOS): expo prebuild sonrası zorunlu
- **Android emulator IP**: localhost yerine `10.0.2.2` (emulator host)
- **Keyboard avoidance**: Modal + TextInput, KeyboardAvoidingView gerekir
- **Safe area**: iPhone notch, SafeAreaView zorunlu her scene'de
- **Orientation**: POS için landscape zorla, bazı ekranlar portrait olabilir
