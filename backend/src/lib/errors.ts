import type { Response } from "express";

/**
 * Returns a generic message to the client and keeps the underlying cause in the
 * server log. Raw Supabase/driver errors can disclose schema details.
 */
export function fail(res: Response, status: number, message: string, cause?: unknown) {
  if (cause) console.error(`[error] ${message}`, cause);
  return res.status(status).json({ error: message });
}
