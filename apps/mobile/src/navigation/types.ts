/**
 * Root navigator param list (ADR-026 K1).
 *
 * The stack is auth-gated: when unauthenticated only `Login` is mounted, when
 * authenticated `Tables` (home) + `Order`. Tapping a table — empty or occupied —
 * pushes `Order` with the table id (web `/tables/:id/order` parity: empty = new
 * bill, occupied = existing). `Order` is the real catalog/cart screen in PR-5c;
 * PR-5b ships a minimal placeholder to prove the Tables -> Order -> back loop on
 * a phone.
 */
export type RootStackParamList = {
  Login: undefined;
  Tables: undefined;
  Order: { tableId: string };
};
