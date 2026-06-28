/**
 * Root navigator param list (ADR-026 K1).
 *
 * The stack is auth-gated: when unauthenticated only `Login` is mounted, when
 * authenticated only `Tables`. Neither screen takes params in PR-5a. Order
 * detail / table detail params arrive in PR-5b/5c.
 */
export type RootStackParamList = {
  Login: undefined;
  Tables: undefined;
};
