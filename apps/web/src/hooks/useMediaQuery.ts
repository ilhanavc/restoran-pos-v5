import { useEffect, useState } from 'react';

/**
 * CSS media query'yi React state olarak dinler. Vite SPA (SSR yok) — ilk
 * render'da `matchMedia` senkron okunur, flicker olmaz.
 *
 * Örn: const isDesktop = useMediaQuery('(min-width: 768px)'); // Tailwind `md`
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(query).matches
      : false,
  );

  useEffect(() => {
    if (
      typeof window === 'undefined' ||
      typeof window.matchMedia !== 'function'
    ) {
      return;
    }
    const mql = window.matchMedia(query);
    const handler = (e: MediaQueryListEvent): void => setMatches(e.matches);
    // Query değişmişse güncel değere senkronize ol, sonra dinle.
    setMatches(mql.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [query]);

  return matches;
}
