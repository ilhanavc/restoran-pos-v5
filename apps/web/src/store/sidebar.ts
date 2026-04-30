import { create } from 'zustand';

interface SidebarState {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
}

/**
 * Sidebar açık/kapalı state — global Zustand store.
 * AppShell yönetir, sayfa header'ları kendi hamburger butonunu çizebilir
 * (v3 paritesi: tüm aksiyonlar sayfa header'ında tek satır).
 */
export const useSidebarStore = create<SidebarState>((set) => ({
  open: true, // default açık desktop'ta
  setOpen: (open) => set({ open }),
  toggle: () => set((s) => ({ open: !s.open })),
}));
