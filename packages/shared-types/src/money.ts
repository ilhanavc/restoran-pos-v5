import { z } from 'zod';

export const MoneyCentsSchema = z.number().int().nonnegative();
export type MoneyCents = z.infer<typeof MoneyCentsSchema>;

export const PositiveCentsSchema = z.number().int().positive();
export type PositiveCents = z.infer<typeof PositiveCentsSchema>;
