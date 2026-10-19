import { z } from "zod";

const DECIMAL = /^-?\d+(\.\d+)?$/;

/**
 * An FPL number that may arrive as a string ("4.65") or a JSON number (0.78); the views
 * hand both over as text. null stays null — never 0. Anything else fails loudly.
 * Never use z.coerce for these: it turns null and "" into 0.
 */
export const fplDecimal = z
  .union([z.string(), z.number(), z.null()])
  .transform((value, ctx) => {
    if (value === null) return null;
    if (typeof value === "number") {
      if (Number.isFinite(value)) return value;
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `not a finite number: ${value}` });
      return z.NEVER;
    }
    const trimmed = value.trim();
    if (DECIMAL.test(trimmed)) return Number(trimmed);
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `not a decimal: ${JSON.stringify(value)}` });
    return z.NEVER;
  });

/** Integer columns from the views: int or null, never coerced. */
export const fplInt = z.number().int().nullable();
