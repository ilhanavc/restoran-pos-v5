import { type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

interface PageHeaderProps {
  /**
   * Page title — must be the result of `t()` call, never a literal Turkish
   * string (Core directive #4: i18n-key only).
   */
  title: string;

  /**
   * Optional muted subtitle below the title.
   */
  subtitle?: string;

  /**
   * Optional lucide-react icon rendered to the left of the title.
   * Color override (e.g. `text-orange-600` for KDS) is applied via Tailwind
   * className utility classes on the wrapper if needed in the future; for now
   * the icon inherits `text-slate-700` from the outer span.
   */
  icon?: LucideIcon;

  /**
   * Optional right-aligned slot for action buttons (refresh, "Yeni X", etc.).
   */
  actions?: ReactNode;

  /**
   * Optional left-aligned slot rendered before the icon/title — meant for
   * back navigation buttons. Platform convention (Gmail, Shopify admin):
   * back belongs at the top-left, not in the right `actions` slot.
   * ADR-011 Amendment 2026-05-12 (HCI feedback addendum).
   */
  startActions?: ReactNode;

  /**
   * Optional centered slot between title and right actions. Reserved for the
   * primary call-to-action when a page has three semantic groups (counter +
   * primary action + secondary icons). v3 parity (e.g. TablesListPage
   * "Paket" button centered between sayaç and Phone/Refresh icons).
   * ADR-011 Amendment 2026-05-12 (HCI feedback addendum).
   */
  centerActions?: ReactNode;
}

/**
 * Canonical page header — ADR-011 Amendment 2026-05-11.
 *
 * Single source of truth for the top header strip on every authenticated page
 * inside `AppShell`. Replaces three divergent patterns (text-xl bold,
 * text-[22px] extrabold, text-2xl extrabold) with one consistent design.
 *
 * Layout rules (locked by amendment):
 * - `pl-16` (64px) reserves space for the fixed hamburger button
 *   (AppShell — `left-3 top-3 h-[42px] w-[42px]`).
 * - Heading uses `text-xl font-bold tracking-tight text-slate-900` only.
 * - `text-2xl`, `text-[22px]`, `font-extrabold`, and inline color styles are
 *   forbidden here and enforced via grep CI gate.
 * - Outer flex distributes title group (left) and actions (right).
 *
 * v3 parity: overlay sidebar + page-owned header (no topbar).
 * Reference: D:\dev\restoran-pos-v3\client\src\App.jsx:274-279.
 */
export function PageHeader({
  title,
  subtitle,
  icon: Icon,
  actions,
  startActions,
  centerActions,
}: PageHeaderProps): JSX.Element {
  return (
    <header className="flex items-center gap-3 border-b border-border bg-white px-6 py-4 pl-16">
      <div className="flex min-w-0 items-center gap-3">
        {startActions ? (
          <div className="flex shrink-0 items-center gap-2">{startActions}</div>
        ) : null}
        {Icon ? (
          <Icon
            className="h-6 w-6 shrink-0 text-slate-700"
            aria-hidden="true"
          />
        ) : null}
        <div className="min-w-0">
          <h1 className="text-xl font-bold tracking-tight text-slate-900">
            {title}
          </h1>
          {subtitle ? (
            <p className="mt-1 text-sm text-slate-600">{subtitle}</p>
          ) : null}
        </div>
      </div>
      <div className="flex flex-1 items-center justify-center">
        {centerActions ?? null}
      </div>
      {actions ? (
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      ) : null}
    </header>
  );
}
