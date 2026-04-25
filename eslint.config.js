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
  {
    files: [
      'apps/web/**/*.ts', 'apps/web/**/*.tsx',
      'apps/mobile/**/*.ts', 'apps/mobile/**/*.tsx',
      'packages/shared-ui/**/*.ts', 'packages/shared-ui/**/*.tsx',
    ],
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
];
