import { z } from 'zod';

/**
 * Vite exposes only VITE_-prefixed variables to the client bundle.
 *
 * Dev: boş URL → axios `baseURL: ''` ile relative path → Vite proxy
 * (vite.config.ts) backend'e forward eder. Cross-port cookie sorunu yok,
 * frontend ↔ backend tek origin görünür.
 *
 * Prod: explicit URL set edilir (Hetzner Nginx aynı origin'de barındırır).
 */
const envSchema = z.object({
  VITE_API_BASE_URL: z.string().default(''),
  VITE_SOCKET_URL: z.string().default(''),
  VITE_SUPPORT_PHONE: z.string().min(1).default('0532 000 00 00'),
});

export const env = envSchema.parse({
  VITE_API_BASE_URL: import.meta.env.VITE_API_BASE_URL,
  VITE_SOCKET_URL: import.meta.env.VITE_SOCKET_URL,
  VITE_SUPPORT_PHONE: import.meta.env.VITE_SUPPORT_PHONE,
});
