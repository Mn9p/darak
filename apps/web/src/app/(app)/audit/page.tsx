import Link from "next/link";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { AUDIT_ACTIONS, ENTITY_TYPES, ENTITY_ROUTES } from "@/lib/constants";
import { datetime, safeJson, money, pageParam, startOfDay } from "@/lib/format";
import { PageHeader, Card, Table, StatusTag, EmptyState, Pagination, FilterBar, Input, Select, StatGrid, StatCard, Alert } from "@/components/ui";
import { MoreMenu } from "@/components/MoreMenu";
import { MoreFilters } from "@/components/MoreFilters";
import { textLike } from "@/lib/search";

export const dynamic = "force-dynamic";
const PAGE = 50;

export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireStaff();
  if (!can(user, "audit.view")) redirect("/forbidden");
  const sp = await searchParams;
  const org = user.organizationId;
  const page = pageParam(sp.page);
  const q = sp.q?.trim();
  const from = sp.from ? new Date(sp.from) : null;
  const to = sp.to ? new Date(`${sp.to}T23:59:59.999`) : null;

  const where = {
    organizationId: org,
    ...(sp.action ? { action: sp.action } : {}),
    ...(sp.entityType ? { entityType: sp.entityType } : {}),
    ...(sp.userId ? { userId: sp.userId } : {}),
    ...(from || to ? { createdAt: { ...(from && !Number.isNaN(from.getTime()) ? { gte: from } : {}), ...(to && !Number.isNaN(to.getTime()) ? { lte: to } : {}) } } : {}),
    ...(q ? { OR: [{ entityLabel: textLike(q) }, { entityId: textLike(q) }, { userName: textLike(q) }] } : {}),
  };

  const today = startOfDay();
  const [total, rows, users, todayCount, exportsCount, sensitive] = await Promise.all([
    db.auditLog.count({ where }),
    db.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * PAGE, take: PAGE }),
    db.user.findMany({ where: { organizationId: org }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.auditLog.count({ where: { organizationId: org, createdAt: { gte: today } } }),
    db.auditLog.count({ where: { organizationId: org, action: "EXPORT" } }),
    db.auditLog.count({ where: { organizationId: org, action: { in: ["DELETE", "PERMISSION_CHANGE", "SUPPORT_ACCESS"] } } }),
  ]);
  const hasFilters = Boolean(sp.q || sp.action || sp.entityType || sp.userId || sp.from || sp.to);
  const exportQuery = new URLSearchParams(Object.entries(sp).filter(([k, v]) => v && k !== "page") as [string, string][]).toString();
  const canExport = can(user, "reports.export");

  return (
    <>
      <PageHeader
        title="سجل العمليات"
        subtitle="كل عملية إنشاء أو تعديل أو اعتماد أو تصدير، ومن قام بها ومتى."
        actions={<MoreMenu items={[canExport && { label: "تصدير Excel", href: `/audit/export?${exportQuery}${exportQuery ? "&" : ""}format=xlsx` }, canExport && { label: "تصدير CSV", href: `/audit/export?${exportQuery}` }]} />}
      />

      <StatGrid cols={4}>
        <StatCard label="السجلات" value={money(total)} sub={hasFilters ? "حسب الفلاتر الحالية" : undefined} />
        <StatCard label="عمليات اليوم" value={money(todayCount)} />
        <StatCard label="عمليات تصدير" value={money(exportsCount)} href="/audit?action=EXPORT" />
        <StatCard label="عمليات حساسة" value={money(sensitive)} sub="حذف · صلاحيات · دخول دعم" tone={sensitive ? "warning" : undefined} />
      </StatGrid>

      <Card className="mt-4" padded={false}>
        <div className="px-4 pt-4">
          <FilterBar base="/audit" hasFilters={hasFilters}>
            <Input name="q" placeholder="بحث بالاسم أو المعرّف أو المستخدم" defaultValue={sp.q ?? ""} className="!w-56" />
            <Select name="action" options={AUDIT_ACTIONS} placeholder="كل الإجراءات" defaultValue={sp.action ?? ""} className="!w-40" />
            <Select name="entityType" options={{ ...ENTITY_TYPES, REPORT: "تقرير", AUDIT: "سجل العمليات", NOTIFICATION_RULE: "قاعدة إشعار", NOTIFICATION_TEMPLATE: "قالب إشعار" }} placeholder="كل الكيانات" defaultValue={sp.entityType ?? ""} className="!w-40" />
            <MoreFilters open={Boolean(sp.userId || sp.from || sp.to)}>
              <Select name="userId" options={users.map((u) => ({ value: u.id, label: u.name }))} placeholder="كل المستخدمين" defaultValue={sp.userId ?? ""} className="!w-44" />
              <Input name="from" type="date" defaultValue={sp.from ?? ""} className="!w-36" title="من" />
              <Input name="to" type="date" defaultValue={sp.to ?? ""} className="!w-36" title="إلى" />
            </MoreFilters>
          </FilterBar>
        </div>
        {rows.length === 0 ? (
          <EmptyState title={hasFilters ? "لا توجد سجلات مطابقة" : "لا توجد عمليات مسجلة حتى الآن"} description={hasFilters ? "جرّب توسيع الفترة أو إزالة بعض الفلاتر." : "ستظهر هنا كل العمليات فور تنفيذها."} action={hasFilters ? <Link href="/audit" className="btn btn-outline">مسح الفلاتر</Link> : undefined} />
        ) : (
          <Table>
            <thead>
              <tr>
                <th>الوقت</th>
                <th>المستخدم</th>
                <th>الإجراء</th>
                <th>الكيان</th>
                <th>الجهاز</th>
                <th>التفاصيل</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => {
                const route = ENTITY_ROUTES[a.entityType];
                const oldV = safeJson<unknown>(a.oldValue, a.oldValue);
                const newV = safeJson<unknown>(a.newValue, a.newValue);
                const hasDetail = a.oldValue || a.newValue;
                return (
                  <tr key={a.id} className="align-top">
                    <td className="whitespace-nowrap text-[12.5px] text-muted">{datetime(a.createdAt)}</td>
                    <td>
                      {a.userId ? (
                        <Link href={`/employees/${a.userId}`} className="cell-primary hover:text-brand">
                          {a.userName}
                        </Link>
                      ) : (
                        <span className="cell-primary">{a.userName ?? "النظام"}</span>
                      )}
                    </td>
                    <td>
                      <StatusTag value={a.action} map={AUDIT_ACTIONS} />
                    </td>
                    <td>
                      {route && a.entityId ? (
                        <Link href={`${route}/${a.entityId}`} className="link text-[13px]">
                          {a.entityLabel ?? a.entityId}
                        </Link>
                      ) : (
                        <span className="text-[13px]">{a.entityLabel ?? a.entityId ?? "—"}</span>
                      )}
                      <div className="cell-sub">{ENTITY_TYPES[a.entityType] ?? a.entityType}</div>
                    </td>
                    <td className="latin max-w-[160px] text-[11.5px] text-muted">
                      <div className="truncate" title={a.device ?? ""}>
                        {a.device ? a.device.slice(0, 40) + (a.device.length > 40 ? "…" : "") : "—"}
                      </div>
                      <div className="cell-sub latin">{a.ip ?? "—"}</div>
                    </td>
                    <td>
                      {hasDetail ? (
                        <details className="min-w-[220px]">
                          <summary className="link text-[12.5px]">عرض التغييرات</summary>
                          <Diff oldV={oldV} newV={newV} />
                        </details>
                      ) : (
                        <span className="text-faint">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
        <Pagination page={page} pageSize={PAGE} total={total} base="/audit" params={sp} />
      </Card>
      <div className="mt-3">
        <Alert tone="neutral">هذا السجل للقراءة فقط ولا يمكن تعديله أو حذف سجلاته.</Alert>
      </div>
    </>
  );
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function Diff({ oldV, newV }: { oldV: unknown; newV: unknown }) {
  if (isObj(oldV) || isObj(newV)) {
    const o = isObj(oldV) ? oldV : {};
    const n = isObj(newV) ? newV : {};
    const keys = [...new Set([...Object.keys(o), ...Object.keys(n)])];
    const fmt = (v: unknown) => (v === undefined ? "" : typeof v === "object" ? JSON.stringify(v, null, 1) : String(v ?? "—"));
    return (
      <div className="mt-2 grid grid-cols-2 gap-2 text-[12px]">
        <div className="rounded-lg bg-danger-bg/40 p-2">
          <div className="mb-1 font-bold text-muted">القيمة السابقة</div>
          {keys.map((k) => {
            const changed = JSON.stringify(o[k]) !== JSON.stringify(n[k]);
            return (
              <div key={k} className={`flex gap-1 ${changed && k in o ? "font-semibold text-danger" : "text-muted"}`}>
                <span className="latin shrink-0">{k}:</span>
                <span className="latin break-all whitespace-pre-wrap" dir="auto">
                  {k in o ? fmt(o[k]) : "—"}
                </span>
              </div>
            );
          })}
          {!Object.keys(o).length && <span className="text-faint">—</span>}
        </div>
        <div className="rounded-lg bg-success-bg/50 p-2">
          <div className="mb-1 font-bold text-muted">القيمة الجديدة</div>
          {keys.map((k) => {
            const changed = JSON.stringify(o[k]) !== JSON.stringify(n[k]);
            return (
              <div key={k} className={`flex gap-1 ${changed && k in n ? "font-semibold text-success" : "text-muted"}`}>
                <span className="latin shrink-0">{k}:</span>
                <span className="latin break-all whitespace-pre-wrap" dir="auto">
                  {k in n ? fmt(n[k]) : "—"}
                </span>
              </div>
            );
          })}
          {!Object.keys(n).length && <span className="text-faint">—</span>}
        </div>
      </div>
    );
  }
  return (
    <div className="mt-2 grid grid-cols-2 gap-2 text-[12px]">
      <pre className="latin whitespace-pre-wrap rounded-lg bg-danger-bg/40 p-2" dir="auto">
        {oldV ? (typeof oldV === "string" ? oldV : JSON.stringify(oldV, null, 1)) : "—"}
      </pre>
      <pre className="latin whitespace-pre-wrap rounded-lg bg-success-bg/50 p-2" dir="auto">
        {newV ? (typeof newV === "string" ? newV : JSON.stringify(newV, null, 1)) : "—"}
      </pre>
    </div>
  );
}
