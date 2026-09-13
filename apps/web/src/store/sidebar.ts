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
  // Başlangıçta KAPALI (ürün-sahibi kararı, S124): store persist edilmediğinden
  // her sayfa yüklemesi/yenilemesi bu değerle başlar → sidebar artık otomatik
  // AÇILMAZ; kullanıcı hamburger butonuyla açar. Sidebar overlay (içeriği
  // itmez), o yüzden kapalı-başlangıç ekranı sadeleştirir, akışı bozmaz.
  open: false,
  setOpen: (open) => set({ open }),
  toggle: () => set((s) => ({ open: !s.open })),
}));
