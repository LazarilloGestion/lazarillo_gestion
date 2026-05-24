import { z } from "zod";

export const mesSchema = z.coerce.number().int().min(1).max(12);
export const yearSchema = z.coerce.number().int().min(1900).max(2100);
export const idSchema = z.coerce.number().int().positive();
export const codigoSchema = z.string().max(50);
