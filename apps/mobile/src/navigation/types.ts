/**
 * Root navigator param list (ADR-026 K1).
 *
 * The stack is auth-gated: when unauthenticated only `Login` is mounted, when
 * authenticated `Tables` (home) + `Order`. Tapping a table — empty or occupied —
 * pushes `Order` with the table id (web `/tables/:id/order` parity: empty = new
 * bill, occupied = existing). `Order` is the catalog/cart screen (PR-5c): the
 * Adisyon view is a bottom-sheet on top of it, not a separate route (ADR-026 K1).
 */
export type RootStackParamList = {
  Login: undefined;
  Tables: undefined;
  Order: { tableId: string };
  Settings: undefined;
};
