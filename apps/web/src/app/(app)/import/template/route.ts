import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { IMPORT_FIELDS, IMPORT_ENTITIES, type ImportEntity } from "../spec";

export const dynamic = "force-dynamic";

// A leading = + - @ tab or CR would be executed as a formula by Excel/Sheets — neutralize with a quote.
const esc = (raw: string) => {
  const v = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
};

/** GET /import/template?type=PROPERTIES → CSV template (UTF-8 BOM, Arabic header row + one example row). */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user || !user.organizationId || !can(user, "import.manage")) return new Response("Unauthorized", { status: 401 });
  const url = new URL(req.url);
  const type = (url.searchParams.get("type") ?? "").toUpperCase();
  if (!(type in IMPORT_ENTITIES)) return new Response("Unknown type", { status: 400 });
  const fields = IMPORT_FIELDS[type as ImportEntity];
  const header = fields.map((f) => esc(f.label)).join(",");
  const example = fields.map((f) => esc(f.example)).join(",");
  const csv = `﻿${header}\r\n${example}\r\n`;
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="darak-template-${type.toLowerCase()}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
