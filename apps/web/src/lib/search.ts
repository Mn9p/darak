// Text filters for list searches. Server-only (reads DATABASE_URL).
// SQLite's LIKE ignores case for Latin letters, PostgreSQL's does not — codes ("prp-0001"), emails and Latin names would
// stop matching after the move to Postgres, so the insensitive mode is added there. Arabic text is unaffected either way.
import { isSqlite } from "@darak/db";
import { normalizePhone } from "./phone";

/** `contains` filter, case-insensitive on every database. */
export function textLike(q: string): { contains: string } {
  return (isSqlite() ? { contains: q } : { contains: q, mode: "insensitive" }) as { contains: string };
}

/** Phone filter: whatever form the user typed (05…, +966…, spaces) matches the stored 9665… value. */
export function phoneLike(q: string): { contains: string } {
  return { contains: normalizePhone(q) ?? q.replace(/[\s\-()]/g, "") };
}
