import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { can, propertyIdScope, propertyScope } from "@/lib/permissions";
import { EXPENSE_CATEGORIES, APPROVAL_STATUS } from "@/lib/constants";
import { money, date, startOfMonth, endOfMonth, monthLabel, pageParam } from "@/lib/format";
import { PageHeader, Card, Table, StatusTag, EmptyState, Pagination, FilterBar, Input, Select, StatGrid, StatCard, ActionButton } from "@/components/ui";
import { GuideCard } from "@/components/GuideCard";
import { MoreMenu } from "@/components/MoreMenu";
import { MoreFilters } from "@/components/MoreFilters";
import { approveExpense, rejectExpense } from "./actions";
import { getOrgSettings } from "@/lib/engine";
import { textLike } from "@/lib/search";

export const dynamic = "force-dynamic";
const PAGE = 20;

export default async function ExpensesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireStaff();
  const sp = await searchParams;
  const org = user.organizationId;
  const page = pageParam(sp.page);
  const q = sp.q?.trim();
  const from = sp.from ? new Date(sp.from) : null;
  const to = sp.to ? new Date(`${sp.to}T23:59:59.999`) : null;

  const where = {
    organizationId: org,
    ...propertyIdScope(user),
    ...(sp.category ? { category: sp.category } : {}),
    ...(sp.approval ? { approvalStatus: sp.approval } : {}),
    ...(sp.propertyId ? { propertyId: sp.propertyId } : {}),
    ...(sp.ownerId ? { ownerId: sp.ownerId } : {}),
    ...(from || to ? { date: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
    ...(q ? { OR: [{ description: textLike(q) }, { code: textLike(q) }, { invoiceNumber: textLike(q) }] } : {}),
  };

  const now = new Date();
  const monthWhere = { organizationId: org, ...propertyIdScope(user), date: { gte: startOfMonth(now), lte: endOfMonth(now) } };

  const [total, rows, properties, owners, monthByStatus, pendingAll] = await Promise.all([
    db.expense.count({ where }),
    db.expense.findMany({
      where,
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * PAGE,
      take: PAGE,
      include: {
        property: { select: { id: true, name: true } },
        unit: { select: { id: true, number: true } },
        owner: { select: { id: true, name: true } },
        approvedBy: { select: { name: true } },
      },
    }),
    db.property.findMany({ where: { organizationId: org, status: { not: "ARCHIVED" }, ...propertyScope(user) }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.owner.findMany({ where: { organizationId: org, status: { not: "ARCHIVED" } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.expense.groupBy({ by: ["approvalStatus"], where: monthWhere, _sum: { amount: true, vatAmount: true }, _count: true }),
    db.expense.aggregate({ where: { organizationId: org, ...propertyIdScope(user), approvalStatus: "PENDING" }, _sum: { amount: true, vatAmount: true }, _count: true }),
  ]);

  const sumOf = (s: string) => {
    const r = monthByStatus.find((x) => x.approvalStatus === s);
    return { count: r?._count ?? 0, amount: (r?._sum.amount ?? 0) + (r?._sum.vatAmount ?? 0) };
  };
  const approvedMonth = sumOf("APPROVED");
  const rejectedMonth = sumOf("REJECTED");
  const monthAll = monthByStatus.reduce((a, r) => ({ count: a.count + r._count, amount: a.amount + (r._sum.amount ?? 0) + (r._sum.vatAmount ?? 0) }), { count: 0, amount: 0 });
  const pendingAmount = (pendingAll._sum.amount ?? 0) + (pendingAll._sum.vatAmount ?? 0);
  const hasFilters = Boolean(sp.q || sp.category || sp.approval || sp.propertyId || sp.ownerId || sp.from || sp.to);
  const canApprove = can(user, "expenses.approve");
  const isManager = ["OFFICE_MANAGER", "SUPER_ADMIN"].includes(user.role);
  const approvalLimit = canApprove && !isManager ? (await getOrgSettings(org)).managerApprovalLimit : Number.POSITIVE_INFINITY;

  return (
    <>
      <PageHeader
        title="المصروفات"
        actions={
          <>
            {can(user, "expenses.manage") && (
              <Link href="/expenses/new" className="btn btn-primary btn-sm">
                تسجيل مصروف
              </Link>
            )}
          </>
        }
      />

      <GuideCard
        id="expenses"
        show={total === 0 && !hasFilters}
        title="المصروفات: ما يُصرف على العقار ويُخصم من كشف المالك"
        steps={[
          "سجّل المصروف على العقار (أو الوحدة) مع الفئة والمبلغ وصورة الفاتورة.",
          "ما يتجاوز حد الاعتماد ينتظر موافقة مدير المكتب.",
          "المصروف المعتمد يُخصم تلقائيًا من كشف حساب المالك في فترته.",
        ]}
        cta={properties.length ? { href: "/expenses/new", label: "تسجيل مصروف" } : { href: "/properties/new", label: "ابدأ بإضافة عقار" }}
        secondary={{ href: "/statements", label: "كشوف الحساب" }}
      />

      <StatGrid cols={4}>
        <StatCard label={`مصروفات ${monthLabel(now)}`} value={money(monthAll.amount)} sub={`${monthAll.count} مصروف`} />
        <StatCard label="المعتمد هذا الشهر" value={money(approvedMonth.amount)} sub={`${approvedMonth.count} مصروف`} tone="success" />
        <StatCard label="بانتظار الاعتماد" value={money(pendingAmount)} sub={`${pendingAll._count} مصروف`} tone={pendingAll._count > 0 ? "warning" : undefined} href="/expenses?approval=PENDING" />
        <StatCard label="المرفوض هذا الشهر" value={money(rejectedMonth.amount)} sub={`${rejectedMonth.count} مصروف`} tone={rejectedMonth.count > 0 ? "danger" : undefined} href="/expenses?approval=REJECTED" />
      </StatGrid>

      <Card className="mt-4" padded={false}>
        <div className="px-4 pt-4">
          <FilterBar base="/expenses" hasFilters={hasFilters}>
            <Input name="q" placeholder="بحث بالوصف أو الرقم أو الفاتورة" defaultValue={sp.q ?? ""} className="!w-56" />
            <Select name="category" options={EXPENSE_CATEGORIES} placeholder="كل الفئات" defaultValue={sp.category ?? ""} className="!w-40" />
            <Select name="approval" options={APPROVAL_STATUS} placeholder="كل حالات الاعتماد" defaultValue={sp.approval ?? ""} className="!w-44" />
            <MoreFilters open={Boolean(sp.propertyId || sp.ownerId || sp.from || sp.to)}>
              <Select name="propertyId" options={properties.map((p) => ({ value: p.id, label: p.name }))} placeholder="كل العقارات" defaultValue={sp.propertyId ?? ""} className="!w-44" />
              <Select name="ownerId" options={owners.map((o) => ({ value: o.id, label: o.name }))} placeholder="كل الملاك" defaultValue={sp.ownerId ?? ""} className="!w-40" />
              <Input name="from" type="date" defaultValue={sp.from ?? ""} className="!w-36" title="من تاريخ" />
              <Input name="to" type="date" defaultValue={sp.to ?? ""} className="!w-36" title="إلى تاريخ" />
            </MoreFilters>
          </FilterBar>
        </div>
        {rows.length === 0 ? (
          <EmptyState
            title={hasFilters ? "لا توجد نتائج مطابقة" : "لا توجد مصروفات حتى الآن"}
            description={hasFilters ? "جرّب تعديل الفلاتر." : "سجّل أول مصروف على عقار."}
            action={!hasFilters && can(user, "expenses.manage") ? <Link href="/expenses/new" className="btn btn-primary">تسجيل مصروف</Link> : undefined}
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <th>الرقم</th>
                <th>العقار</th>
                <th>الوصف</th>
                <th>الفئة</th>
                <th className="num">الإجمالي</th>
                <th>الاعتماد</th>
                {canApprove && <th></th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id}>
                  <td>
                    <Link href={`/expenses/${e.id}`} className="cell-primary latin hover:text-brand">
                      {e.code}
                    </Link>
                    <div className="cell-sub">{date(e.date)}</div>
                  </td>
                  <td>
                    <Link href={`/properties/${e.property.id}`} className="hover:text-brand">
                      {e.property.name}
                    </Link>
                    {e.unit && <div className="cell-sub latin">وحدة {e.unit.number}</div>}
                  </td>
                  <td>
                    <div className="max-w-[240px] truncate" title={e.description}>
                      {e.description}
                    </div>
                    {e.owner && (
                      <div className="cell-sub">
                        المالك:{" "}
                        <Link href={`/owners/${e.owner.id}`} className="hover:text-brand">
                          {e.owner.name}
                        </Link>
                      </div>
                    )}
                  </td>
                  <td>
                    {EXPENSE_CATEGORIES[e.category] ?? e.category}
                    {e.payee && <div className="cell-sub">{e.payee}</div>}
                  </td>
                  <td className="num font-semibold">
                    {money(e.amount + e.vatAmount, { decimals: true })}
                    {e.vatAmount > 0 && <div className="cell-sub num">ضريبة {money(e.vatAmount, { decimals: true })}</div>}
                  </td>
                  <td>
                    <StatusTag value={e.approvalStatus} map={APPROVAL_STATUS} />
                    {e.approvedBy && e.approvalStatus !== "PENDING" && <div className="cell-sub">{e.approvedBy.name}</div>}
                  </td>
                  {canApprove && (
                    <td>
                      {e.approvalStatus === "PENDING" && e.amount + e.vatAmount > approvalLimit && <span className="text-[11.5px] text-muted">يعتمده مدير المكتب</span>}
                      {e.approvalStatus === "PENDING" && e.amount + e.vatAmount <= approvalLimit && (
                        <div className="flex items-center gap-1">
                          <ActionButton action={approveExpense} hidden={{ id: e.id }} className="btn btn-success-soft btn-xs">
                            اعتماد
                          </ActionButton>
                          <ActionButton action={rejectExpense} hidden={{ id: e.id, reason: "رفض من قائمة المصروفات" }} className="btn btn-danger-soft btn-xs" confirm="هل تريد رفض هذا المصروف؟">
                            رفض
                          </ActionButton>
                        </div>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <Pagination page={page} pageSize={PAGE} total={total} base="/expenses" params={sp} />
      </Card>
    </>
  );
}
