/**
 * An identifier someone typed, made safe to hand to `.ilike()`.
 *
 * PostgREST passes an ilike value to Postgres as a LIKE pattern: `%` and `_`
 * are wildcards, and PostgREST also turns `*` into `%`. Used raw, a typed
 * `j_n@example.com` matches the stored `jan@example.com`, and /recover once mailed that
 * family's reset link to whoever typed it. Escaping the metacharacters makes
 * ilike an exact, case-insensitive comparison.
 *
 * `*` cannot be escaped through PostgREST, so an identifier containing one
 * matches nothing: the caller gets `null` and must answer "not found".
 */
export function exactIlike(value: string): string | null {
  if (value.includes("*")) return null;
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}
