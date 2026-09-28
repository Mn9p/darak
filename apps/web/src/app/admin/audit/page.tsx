import Link from "next/link";
import { requireSuperAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { num, datetime, addDays, pageParam } from "@/lib/format";
import { AUDIT_ACTIONS, ENTITY_TYPES } from "@/lib/constants";
import { PageHeader, Card, Table, StatusTag, EmptyState, FilterBar, Select, Input, Pagination, StatGrid, StatCard, Alert, Tag } from "@/components/ui";
import { textLike } from "@/lib/search";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 50;
const SENSITIVE = ["DELETE", "PERMISSION_CHANGE", "SUPPORT_ACCESS"];

export default async function PlatformAuditPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireSuperAdmin();
  const sp = await searchParams;
  const page = pageParam(sp.page);
  const q = sp.q?.trim();
  const from = sp.from ? new Date(sp.from) : null;
  const to = sp.to ? new Date(`${sp.to}T23:59:59.999`) : null;
  const dayAgo = addDays(new Date(), -1);

  const where = {
    ...(sp.org === "platform" ? { organizationId: null } : sp.org ? { organizationId: sp.org } : {}),
    ...(sp.action === "sensitive" ? { action: { in: SENSITIVE } } : sp.action ? { action: sp.action } : {}),
    ...(sp.entityType ? { entityType: sp.entityType } : {}),
    ...(from || to ? { createdAt: { ...(from && !Number.isNaN(from.getTime()) ? { gte: from } : {}), ...(to && !Number.isNaN(to.getTime()) ? { lte: to } : {}) } } : {}),
    ...(q ? { OR: [{ entityLabel: textLike(q) }, { entityId: textLike(q) }, { userName: textLike(q) }] } : {}),
  };

  const [total, rows, orgs, last24h, supportAccess, sensitive, platformOnly] = await Promise.all([
    db.auditLog.count({ where }),
    db.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE, include: { organization: { select: { id: true, name: true } } } }),
    db.organization.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.auditLog.count({ where: { createdAt: { gte: dayAgo } } }),
    db.auditLog.count({ where: { action: "SUPPORT_ACCESS", organizationId: null } }),
    db.auditLog.count({ where: { action: { in: SENSITIVE } } }),
    db.auditLog.count({ where: { organizationId: null } }),
  ]);

  const hasFilters = Boolean(sp.q || sp.org || sp.action || sp.entityType || sp.from || sp.to);
  const entityOptions = { ...ENTITY_TYPES, SUPPORT_TICKET: "تذكرة دعم", REPORT: "تقرير", AUDIT: "سجل العمليات", NOTIFICATION_RULE: "قاعدة إشعار", NOTIFICATION_TEMPLATE: "قالب إشعار" };
  const actionOptions = [{ value: "sensitive", label: "العمليات الحساسة فقط" }, ...Object.entries(AUDIT_ACTIONS).map(([value, m]) => ({ value, label: m.label }))];

  return (
    <>
      <PageHeader title="سجل المنصة" subtitle="سجل غير قابل للتعديل لكل العمليات عبر جميع المكاتب، بما فيها عمليات فريق المنصة ودخول الدعم الفني" />

      <StatGrid cols={4}>
        <StatCard label="إجمالي السجلات" value={num(total)} sub={hasFilters ? "حسب الفلاتر الحالية" : "كل السجل"} dark />
        <StatCard label="آخر 24 ساعة" value={num(last24h)} />
        <StatCard label="عمليات حساسة" value={num(sensitive)} sub="حذف · صلاحيات · دخول دعم" tone={sensitive ? "warning" : undefined} href="/admin/audit?action=sensitive" />
        <StatCard label="دخول دعم فني" value={num(supportAccess)} sub={`${num(platformOnly)} عملية على مستوى المنصة`} href="/admin/audit?org=platform&action=SUPPORT_ACCESS" />
      </StatGrid>

      <Card className="mt-4" padded={false}>
        <div className="px-4 pt-4">
          <FilterBar base="/admin/audit" hasFilters={hasFilters}>
            <Input name="q" placeholder="بحث بالكيان / المعرّف / المستخدم…" defaultValue={sp.q ?? ""} className="!w-52" />
            <Select name="org" options={[{ value: "platform", label: "عمليات المنصة فقط" }, ...orgs.map((o) => ({ value: o.id, label: o.name }))]} placeholder="كل المكاتب" defaultValue={sp.org ?? ""} className="!w-44" />
            <Select name="action" options={actionOptions} placeholder="كل الإجراءات" defaultValue={sp.action ?? ""} className="!w-40" />
            <Select name="entityType" options={entityOptions} placeholder="كل الكيانات" defaultValue={sp.entityType ?? ""} className="!w-40" />
            <Input name="from" type="date" defaultValue={sp.from ?? ""} className="!w-36" title="من" />
            <Input name="to" type="date" defaultValue={sp.to ?? ""} className="!w-36" title="إلى" />
          </FilterBar>
        </div>

        {rows.length === 0 ? (
          <EmptyState title={hasFilters ? "لا توجد سجلات مطابقة" : "لا توجد عمليات مسجلة بعد"} description={hasFilters ? "جرّب توسيع الفترة أو إزالة بعض الفلاتر." : "ستظهر هنا كل العمليات فور تنفيذها."} action={hasFilters ? <Link href="/admin/audit" className="btn btn-outline">مسح الفلاتر</Link> : undefined} />
        ) : (
          <Table>
            <thead>
              <tr>
                <th>الوقت</th>
                <th>المكتب</th>
                <th>المستخدم</th>
                <th>الإجراء</th>
                <th>الكيان</th>
                <th>IP</th>
                <th>التفاصيل</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => {
                const hasDetail = a.oldValue || a.newValue;
                return (
                  <tr key={a.id} className={`align-top ${SENSITIVE.includes(a.action) ? "bg-warning-bg/30" : ""}`}>
                    <td className="num whitespace-nowrap text-[12.5px] text-muted">{datetime(a.createdAt)}</td>
                    <td>
                      {a.organization ? (
                        <Link href={`/admin/organizations/${a.organization.id}?tab=audit`} className="link">{a.organization.name}</Link>
                      ) : (
                        <Tag tone="brand" plain>المنصة</Tag>
                      )}
                    </td>
                    <td className="font-semibold">{a.userName ?? "النظام"}</td>
                    <td><StatusTag value={a.action} map={AUDIT_ACTIONS} /></td>
                    <td>
                      <span className="text-[12px] text-muted">{entityOptions[a.entityType as keyof typeof entityOptions] ?? a.entityType}</span>
                      <div className="text-[13px]">{a.entityLabel ?? a.entityId ?? "—"}</div>
                    </td>
                    <td className="latin text-[12px] text-muted">{a.ip ?? "—"}</td>
                    <td>
                      {hasDetail ? (
                        <details className="min-w-[220px]">
                          <summary className="link text-[12.5px]">عرض التغييرات</summary>
                          <div className="mt-2 grid grid-cols-2 gap-2 text-[12px]">
                            <pre className="latin whitespace-pre-wrap rounded-lg bg-danger-bg/40 p-2" dir="auto">{pretty(a.oldValue)}</pre>
                            <pre className="latin whitespace-pre-wrap rounded-lg bg-success-bg/50 p-2" dir="auto">{pretty(a.newValue)}</pre>
                          </div>
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
        <Pagination page={page} pageSize={PAGE_SIZE} total={total} base="/admin/audit" params={sp} />
      </Card>
      <div className="mt-3">
        <Alert tone="neutral">هذا السجل للقراءة فقط (Append-only). العمليات التي لا تخص مكتبًا محددًا تظهر باسم «المنصة».</Alert>
      </div>
    </>
  );
}

function pretty(v: string | null) {
  if (!v) return "—";
  try {
    return JSON.stringify(JSON.parse(v), null, 1);
  } catch {
    return v;
  }
}
