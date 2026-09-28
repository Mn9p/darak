import { NextResponse, type NextRequest } from "next/server";
import * as XLSX from "xlsx";
import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { AUDIT_ACTIONS, ENTITY_TYPES } from "@/lib/constants";
import { datetime, inputDate } from "@/lib/format";
import { textLike } from "@/lib/search";

export const dynamic = "force-dynamic";
const MAX = 5000;
const HEAD = ["الوقت", "المستخدم", "الإجراء", "نوع الكيان", "الكيان", "معرّف الكيان", "القيمة السابقة", "القيمة الجديدة", "IP", "الجهاز"];

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || !user.organizationId || ["OWNER", "TENANT"].includes(user.role)) return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
  if (!can(user, "audit.view") || !can(user, "reports.export")) return NextResponse.json({ error: "ليس لديك صلاحية التصدير" }, { status: 403 });

  const sp = req.nextUrl.searchParams;
  const format = sp.get("format") === "xlsx" ? "xlsx" : "csv";
  const q = sp.get("q")?.trim();
  const from = sp.get("from") ? new Date(sp.get("from")!) : null;
  const to = sp.get("to") ? new Date(`${sp.get("to")}T23:59:59.999`) : null;
  const where = {
    organizationId: user.organizationId,
    ...(sp.get("action") ? { action: sp.get("action")! } : {}),
    ...(sp.get("entityType") ? { entityType: sp.get("entityType")! } : {}),
    ...(sp.get("userId") ? { userId: sp.get("userId")! } : {}),
    ...(from || to ? { createdAt: { ...(from && !Number.isNaN(from.getTime()) ? { gte: from } : {}), ...(to && !Number.isNaN(to.getTime()) ? { lte: to } : {}) } } : {}),
    ...(q ? { OR: [{ entityLabel: textLike(q) }, { entityId: textLike(q) }, { userName: textLike(q) }] } : {}),
  };
  const rows = await db.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, take: MAX });
  const table: string[][] = rows.map((a) => [datetime(a.createdAt), a.userName, AUDIT_ACTIONS[a.action]?.label ?? a.action, ENTITY_TYPES[a.entityType] ?? a.entityType, a.entityLabel, a.entityId, a.oldValue, a.newValue, a.ip, a.device].map((v) => v ?? ""));

  const filters = Object.fromEntries(sp.entries());
  delete filters.format;
  await audit({ user, action: "EXPORT", entityType: "AUDIT", entityLabel: "سجل العمليات", newValue: { format, rows: rows.length, filters } });

  const base = `darak-audit-${inputDate(new Date())}`;
  if (format === "xlsx") {
    const ws = XLSX.utils.aoa_to_sheet([HEAD, ...table]);
    ws["!cols"] = [18, 22, 14, 14, 36, 28, 40, 40, 16, 24].map((wch) => ({ wch }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "سجل العمليات");
    wb.Workbook = { Views: [{ RTL: true }] };
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${base}.xlsx"`,
        "Content-Length": String(buf.length),
        "Cache-Control": "no-store",
      },
    });
  }

  const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const csv = `${String.fromCharCode(0xfeff)}${HEAD.map(esc).join(",")}\n${table.map((r) => r.map(esc).join(",")).join("\n")}`;
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${base}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
