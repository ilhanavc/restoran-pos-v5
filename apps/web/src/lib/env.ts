import { z } from 'zod';

/**
 * Vite exposes only VITE_-prefixed variables to the client bundle.
 * Defaults are dev-friendly; production builds should set them via .env.
 */
const envSchema = z.object({
  VITE_API_BASE_URL: z.string().url().default('http://localhost:3001'),
  VITE_SOCKET_URL: z.string().url().default('http://localhost:3001'),
  VITE_SUPPORT_PHONE: z.string().min(1).default('0532 000 00 00'),
});

export const env = envSchema.parse({
  VITE_API_BASE_URL: import.meta.env.VITE_API_BASE_URL,
  VITE_SOCKET_URL: import.meta.env.VITE_SOCKET_URL,
  VITE_SUPPORT_PHONE: import.meta.env.VITE_SUPPORT_PHONE,
});
