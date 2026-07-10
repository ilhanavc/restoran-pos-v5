import { describe, expect, it } from 'vitest';
import { encodeCP857 } from './encode-cp857.js';

// Blok 1 audit findings — intentionally RED until bugs fixed.
// See docs/audit/01-shared-domain.md (SD-P-03).
//
// [SD-P-03][HIGH][SEC] encodeCP857's documented "safety net" does not cover
// ASCII control-byte injection.
//
// sanitize-cp857.ts module docstring (line 16-17) and ADR-004 Amendment 5
// K10 (.claude/memory/decisions.md) both assert: "encodeCP857 DEĞİŞMEZ —
// hâlâ throw eder ... sanitize edilmemiş bir alan kalırsa yapısal hata yine
// görünür (safety-net)." That claim is TRUE for unmapped non-ASCII input
// (é, ₺, emoji, ...) but FALSE for raw ASCII control bytes: ESC (0x1B),
// GS (0x1D), NUL (0x00), FF (0x0C), etc. are all < 0x80, so they take the
// unconditional "ASCII passes through" branch and are written to the output
// byte-for-byte — no throw, no strip. If any current or future call site
// forgets to run `sanitizeForCP857` on a free-text field (product note,
// customer name/address), a user-typed ESC sequence reaches the printer as
// a literal command (reset / cut / possible cash-drawer kick) with ZERO
// error signal — silently, exactly the failure mode ADR-004 §7's "no ASCII
// fallback, throw instead of silent degradation" principle was meant to
// prevent.
//
// Verified clean today: apps/api/src/print/templates/kitchen-receipt.ts and
// bill-receipt.ts both call sanitizeForCP857 on every user-controlled field
// before encodeCP857 (grep-verified during this audit) — so there is no
// active exploit path right now. This finding is about the *library-level*
// guarantee being weaker than documented, which is a single point of
// failure for the next template author who trusts the docstring.
describe('[SD-P-03] encodeCP857 does not defend against control-byte injection on its own', () => {
  it('should refuse (throw) raw ESC (0x1B) the same way it refuses unmapped Unicode — currently it does not', () => {
    const injected = 'Not\x1B@tamam'; // ESC @ = printer reset command
    expect(() => encodeCP857(injected)).toThrow();
  });

  it('should never emit raw ESC/GS bytes in its output even when sanitizeForCP857 is skipped (the documented safety-net) — currently it does', () => {
    const injected = 'Fiyat\x1B\x1DDegistir';
    const bytes = Array.from(encodeCP857(injected));
    expect(bytes).not.toContain(0x1b);
    expect(bytes).not.toContain(0x1d);
  });
});
