// Minimal ESLint flat config (ADR-001 §1). Phase 1'de import kısıtları eklenecek.
export default [
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/.turbo/**', '**/generated.ts'],
  },
];
