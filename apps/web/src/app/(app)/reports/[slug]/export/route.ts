import { NextResponse, type NextRequest } from "next/server";
import * as XLSX from "xlsx";
import { getCurrentUser } from "@/lib/auth";
import { can, isScoped } from "@/lib/permissions";
import { audit } from "@/lib/audit";
import { reportBySlug, reportAllowed, parseFilters, runReport, toCsv, type Column, type Row, type Cell } from "../../queries";
import { inputDate } from "@/lib/format";

export const dynamic = "force-dynamic";

/** Native Excel value for a report cell: numbers stay numeric, dates stay dates, links/status become their label. */
function xlsxCell(cell: Cell, col: Column): string | number | Date {
  if (cell === null || cell === undefined) return "";
  if (cell instanceof Date) return cell;
  if (typeof cell === "object") return cell.label;
  if (col.kind === "status" && col.map) return col.map[String(cell)]?.label ?? String(cell);
  if (col.kind === "money" || col.kind === "num" || col.kind === "pct") {
    const n = Number(cell);
    return Number.isFinite(n) ? n : String(cell);
  }
  return String(cell);
}

/** Builds an RTL workbook with one sheet; column widths follow the longest value in the first 200 rows. */
function toXlsx(sheetName: string, columns: Column[], rows: Row[]): Buffer {
  const aoa: (string | number | Date)[][] = [columns.map((c) => c.label), ...rows.map((r) => columns.map((c) => xlsxCell(r[c.key], c)))];
  const ws = XLSX.utils.aoa_to_sheet(aoa, { cellDates: true });
  ws["!cols"] = columns.map((c, i) => {
    const longest = aoa.slice(1, 200).reduce((m, r) => Math.max(m, String(r[i] instanceof Date ? "0000-00-00" : r[i] ?? "").length), 0);
    return { wch: Math.min(60, Math.max(12, c.label.length + 4, longest + 2)) };
  });
  // Money / number columns → 2-decimal format so Excel does not show floating noise.
  columns.forEach((c, i) => {
    if (c.kind !== "money" && c.kind !== "num" && c.kind !== "pct") return;
    for (let r = 1; r < aoa.length; r++) {
      const ref = XLSX.utils.encode_cell({ r, c: i });
      const cell = ws[ref];
      if (cell && cell.t === "n") cell.z = c.kind === "pct" ? "0.0" : "#,##0.00";
    }
  });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.replace(/[\\/?*[\]:]/g, " ").slice(0, 31) || "Sheet1");
  wb.Workbook = { Views: [{ RTL: true }] };
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const user = await getCurrentUser();
  if (!user || !user.organizationId || ["OWNER", "TENANT"].includes(user.role)) return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
  const { slug } = await ctx.params;
  const meta = reportBySlug(slug);
  if (!meta) return NextResponse.json({ error: "التقرير غير موجود" }, { status: 404 });
  if (!can(user, "reports.view") || !can(user, "reports.export")) return NextResponse.json({ error: "ليس لديك صلاحية التصدير" }, { status: 403 });
  if (!reportAllowed(user, meta)) return NextResponse.json({ error: "ليس لديك صلاحية هذا التقرير" }, { status: 403 });

  const sp = Object.fromEntries(req.nextUrl.searchParams.entries());
  const format = sp.format === "xlsx" ? "xlsx" : "csv";
  const f = parseFilters(sp);
  if (f.propertyId && isScoped(user) && !user.assignedPropertyIds.includes(f.propertyId)) return NextResponse.json({ error: "العقار خارج نطاقك" }, { status: 403 });

  const result = await runReport(slug, user as typeof user & { organizationId: string }, f);
  await audit({ user, action: "EXPORT", entityType: "REPORT", entityId: slug, entityLabel: meta.title, newValue: { format, rows: result.rows.length, period: f.period, from: f.from, to: f.to, propertyId: f.propertyId ?? null, ownerId: f.ownerId ?? null } });

  const base = `darak-${slug}-${inputDate(f.from)}_${inputDate(f.to)}`;
  if (format === "xlsx") {
    const buf = toXlsx(meta.title, result.columns, result.rows);
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${base}.xlsx"`,
        "Content-Length": String(buf.length),
        "Cache-Control": "no-store",
      },
    });
  }

  const csv = toCsv(result.columns, result.rows);
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${base}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
