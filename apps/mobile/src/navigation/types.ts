import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type {
  CompositeScreenProps,
  NavigatorScreenParams,
} from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

/**
 * Navigator param lists (ADR-026 K1 + Amendment 5 K2).
 *
 * Topology: root `Stack` = [Login, Main, Order]; `Main` = bottom tabs
 * [Tables, Sales, Kitchen, Settings]. The root stack stays auth-gated (only
 * `Login` is mounted while signed out), and `Order` deliberately lives OUTSIDE
 * the tab bar: taking an order is a full-screen, focused task, so the waiter
 * cannot switch tabs mid-cart and lose unsaved lines (K2).
 *
 * Tapping a table — empty or occupied — pushes `Order` with the table id (web
 * `/tables/:id/order` parity: empty = new bill, occupied = existing). The
 * Adisyon view is a bottom-sheet on top of `Order`, not a separate route.
 */
export type MainTabParamList = {
  Tables: undefined;
  /** Yalnız admin/cashier için kayıtlıdır (Amd5 K1 rol matrisi). */
  Sales: undefined;
  Kitchen: undefined;
  Settings: undefined;
};

export type RootStackParamList = {
  Login: undefined;
  Main: NavigatorScreenParams<MainTabParamList> | undefined;
  Order: { tableId: string };
};

/**
 * Screen props for a TAB screen. Composite because a tab screen may also drive
 * the parent stack (e.g. Masalar pushes `Order`); `any` is banned (CLAUDE.md),
 * so the two navigators are composed at the type level instead.
 */
export type MainTabScreenProps<T extends keyof MainTabParamList> =
  CompositeScreenProps<
    BottomTabScreenProps<MainTabParamList, T>,
    NativeStackScreenProps<RootStackParamList>
  >;

/** Screen props for a ROOT STACK screen (Login / Order). */
export type RootStackScreenProps<T extends keyof RootStackParamList> =
  NativeStackScreenProps<RootStackParamList, T>;
