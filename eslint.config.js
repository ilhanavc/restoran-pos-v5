import tseslint from 'typescript-eslint';

export default [
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/.turbo/**', '**/generated.ts'],
  },

  // ──────────────────────────────────────────────────────────────────────
  // TypeScript parser + no-explicit-any
  //
  // ZORUNLU: tseslint.parser + tseslint.plugin tanımlı olmazsa
  // @typescript-eslint/no-explicit-any silent fail eder (lint geçer ama
  // any'leri yakalamaz). Bu kural TÜM .ts/.tsx dosyalarında geçerli —
  // izinli paketler (apps/api, packages/db) için bile any yasak.
  // CLAUDE.md "any yasak" core directive.
  // ──────────────────────────────────────────────────────────────────────
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint.plugin,
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },

  // ──────────────────────────────────────────────────────────────────────
  // ADR-001 §2.2: packages/db import izinleri + Görev 10 DoD: shared-domain pure
  //
  // patterns vs paths:
  //   - patterns: glob/substring match — alt-paketler de yakalanır
  //       '@restoran-pos/db'  → '@restoran-pos/db/queries' de yasak
  //       'kysely'            → 'kysely-codegen' de yasak (istenen)
  //   - paths: exact match — yalnız tam isim yakalanır
  //       'fs'                → import 'fs' yasak
  //       'node:fs'           → ayrıca exact yazılmalı
  // ──────────────────────────────────────────────────────────────────────

  // packages/shared-domain: pure domain — DB + node-built-in yasak
  {
    files: ['packages/shared-domain/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: ['@restoran-pos/db', 'pg', 'kysely', 'express'],
        paths: ['fs', 'node:fs', 'node:net', 'node:http', 'node:dgram', 'node:child_process'],
      }],
    },
  },

  // packages/shared-types: zod-only, DB-agnostic
  {
    files: ['packages/shared-types/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: ['@restoran-pos/db', 'pg', 'kysely', 'express'],
      }],
    },
  },

  // UI/cross-platform: DB tipi sızmaz (zod schema için shared-types)
  // İstisna: apps/web/e2e/** — Playwright test fixture'ları DB'yi doğrudan
  // seed eder (ADR-019 §3 kysely direct). E2E kodu uygulama bundle'ına
  // girmez (testDir Vite/build dışında), bu yüzden DB tipi sızıntısı yok.
  {
    files: [
      'apps/web/**/*.ts', 'apps/web/**/*.tsx',
      'apps/mobile/**/*.ts', 'apps/mobile/**/*.tsx',
      'packages/shared-ui/**/*.ts', 'packages/shared-ui/**/*.tsx',
    ],
    ignores: ['apps/web/e2e/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['@restoran-pos/db'],
          message: 'UI/cross-platform katmanı DB tipini import edemez (ADR-001 §2.2). zod schema için @restoran-pos/shared-types kullanın.',
        }],
      }],
    },
  },

  // İzinli (override yok): apps/api, apps/print-agent, packages/db

  // ADR-003 §10 + CLAUDE.md: payment amounts must be integer cents, never float
  {
    files: [
      'apps/api/**/*.ts',
      'apps/web/**/*.ts',
      'apps/web/**/*.tsx',
      'apps/mobile/**/*.ts',
      'apps/mobile/**/*.tsx',
      'packages/shared-domain/**/*.ts',
      'packages/shared-types/**/*.ts',
      'packages/db/**/*.ts',
    ],
    rules: {
      'no-restricted-globals': ['error',
        {
          name: 'parseFloat',
          message: 'parseFloat is forbidden — use integer cents (ADR-003 §10).',
        },
      ],
      'no-restricted-syntax': ['error',
        {
          selector: "CallExpression[callee.name='parseFloat']",
          message: 'parseFloat is forbidden — use integer cents (ADR-003 §10).',
        },
        {
          selector: "CallExpression[callee.name='Number'][arguments.0.type='Literal'][arguments.0.value=/\\./]",
          message: 'Float literal with Number() is forbidden — use integer cents (ADR-003 §10).',
        },
      ],
    },
  },

  // ADR-010 §11.3 (+ Amendment K5): Direct Socket.IO emit yasak — yalnız
  // realtime/emit.ts helper'ları. Cross-tenant leak ve event-name/payload
  // drift kapısını kapatır. Eski 3-selector (`of.emit`/`io.emit`/`socket.emit`)
  // `.of().to().emit()` ZİNCİRİNİ kaçırıyordu (`.emit` callee.object'i `.to`
  // çağrısı, `of` değil) → porous. Tek broad selector TÜM `.emit()` varyantını
  // yakalar. Test dosyaları (__tests__) hariç — orada client-side socket.emit
  // (socket.io-client) kullanılır.
  {
    files: ['apps/api/src/**/*.ts'],
    ignores: [
      'apps/api/src/realtime/emit.ts',
      'apps/api/src/__tests__/**',
    ],
    rules: {
      'no-restricted-syntax': ['error',
        {
          selector: "CallExpression[callee.property.name='emit']",
          message: 'ADR-010 §11.3: Direct .emit() yasak (io.of(ns).to(room).emit / io.emit / socket.emit dahil). realtime/emit.ts helper kullan (zod parse zorunlu).',
        },
      ],
    },
  },
];
