import Link from "next/link";
import type { SessionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { can, contractScope, isScoped } from "@/lib/permissions";
import { AGING_BUCKETS, COLLECTION_STATUS, COLLECTION_ACTION_TYPES } from "@/lib/constants";
import { money, pct, date, daysOverdue, relative, startOfMonth, endOfMonth, pageParam, startOfDay, endOfDay } from "@/lib/format";
import { PageHeader, Card, Table, StatusTag, EmptyState, Pagination, FilterBar, Input, Select, StatGrid, StatCard, PriorityPill, Tag, ActionButton } from "@/components/ui";
import { MoreMenu } from "@/components/MoreMenu";
import { MoreFilters } from "@/components/MoreFilters";
import { bulkAssign, saveView, deleteView } from "./actions";
import { displayPhone } from "@/lib/phone";
import { textLike, phoneLike } from "@/lib/search";

const PAGE = 25;

/** Flat list of open claims (every property), with saved views and bulk assignment. Reached from /collections?view=list. */
export async function ClaimsList({ user, sp }: { user: SessionUser & { organizationId: string }; sp: Record<string, string | undefined> }) {
  const org = user.organizationId;
  const page = pageParam(sp.page);
  const q = sp.q?.trim();
  const now = new Date();
  const canManage = can(user, "collections.manage");

  // Property filter must stay inside the user's data scope.
  const propertyId = sp.propertyId && (!isScoped(user) || user.assignedPropertyIds.includes(sp.propertyId)) ? sp.propertyId : undefined;
  const scope = contractScope(user);
  const contractWhere = propertyId ? { propertyId } : scope.contract;
  const bucket = AGING_BUCKETS.find((b) => b.key === sp.bucket);
  const minAmount = Number(sp.minAmount ?? 0) || 0;

  const where = {
    organizationId: org,
    ...(sp.followUpStatus ? { followUpStatus: sp.followUpStatus } : { followUpStatus: { notIn: ["PAID", "CLOSED"] } }),
    ...(sp.collectorId ? { collectorId: sp.collectorId } : {}),
    ...(sp.mine === "1" ? { collectorId: user.id } : {}),
    installment: {
      ...(contractWhere ? { contract: contractWhere } : {}),
      ...(q ? { tenant: { OR: [{ name: textLike(q) }, { phone: phoneLike(q) }] } } : {}),
    },
  };

  const [allRows, collectors, properties, views, openCases, monthInstallments] = await Promise.all([
    db.collectionCase.findMany({
      where,
      orderBy: [{ priority: "desc" }, { updatedAt: "desc" }],
      include: {
        installment: {
          include: {
            tenant: { select: { id: true, name: true, phone: true } },
            contract: { select: { id: true, code: true, unit: { select: { id: true, number: true } }, property: { select: { id: true, name: true } } } },
          },
        },
        collector: { select: { id: true, name: true } },
        actions: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    }),
    db.user.findMany({ where: { organizationId: org, role: { in: ["COLLECTOR", "OFFICE_MANAGER"] }, status: "ACTIVE" }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.property.findMany({ where: { organizationId: org, status: { not: "ARCHIVED" }, ...(isScoped(user) ? { id: { in: user.assignedPropertyIds } } : {}) }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.savedView.findMany({ where: { organizationId: org, module: "collections", OR: [{ userId: user.id }, { isShared: true }] }, orderBy: { createdAt: "asc" } }),
    db.collectionCase.findMany({
      where: { organizationId: org, followUpStatus: { notIn: ["PAID", "CLOSED"] }, ...(scope.contract ? { installment: { contract: scope.contract } } : {}) },
      select: { followUpStatus: true, promiseDate: true, installment: { select: { amount: true, paidAmount: true } } },
    }),
    db.installment.aggregate({
      where: { organizationId: org, dueDate: { gte: startOfMonth(now), lte: endOfMonth(now) }, status: { not: "WAIVED" }, ...scope },
      _sum: { amount: true, paidAmount: true },
    }),
  ]);

  // Computed filters (remaining amount, aging bucket) are applied in memory.
  const filtered = allRows.filter((k) => {
    const remaining = k.installment.amount - k.installment.paidAmount;
    if (minAmount && remaining < minAmount) return false;
    if (bucket) {
      const late = daysOverdue(k.installment.dueDate);
      if (late < bucket.min || late > bucket.max) return false;
    }
    return true;
  });
  const total = filtered.length;
  const rows = filtered.slice((page - 1) * PAGE, page * PAGE);

  const todayStart = startOfDay(now);
  const todayEnd = endOfDay(now);
  const overdueTotal = openCases.reduce((s, k) => s + (k.installment.amount - k.installment.paidAmount), 0);
  const promisesToday = openCases.filter((k) => k.followUpStatus === "PROMISE_TO_PAY" && k.promiseDate && k.promiseDate >= todayStart && k.promiseDate <= todayEnd).length;
  const monthDue = monthInstallments._sum.amount ?? 0;
  const monthPaid = monthInstallments._sum.paidAmount ?? 0;
  const rate = monthDue ? (monthPaid / monthDue) * 100 : 0;

  const filterKeys = ["q", "followUpStatus", "collectorId", "propertyId", "minAmount", "bucket", "mine"] as const;
  const keep = "view=list";
  const hasFilters = filterKeys.some((k) => Boolean(sp[k]));
  const qs = new URLSearchParams();
  filterKeys.forEach((k) => sp[k] && qs.set(k, sp[k]!));
  const query = qs.toString();
  const currentUrl = `/collections?${keep}${query ? `&${query}` : ""}`;
  const mine = sp.mine === "1";

  return (
    <>
      <PageHeader
        title="كل المطالبات"
        subtitle="المطالبات المفتوحة في كل العقارات مرتبة حسب الأولوية."
        breadcrumbs={[{ label: "التحصيل", href: "/collections" }, { label: "كل المطالبات" }]}
        actions={
          <>
            {can(user, "payments.manage") && (
              <Link href="/payments/new" className="btn btn-primary btn-sm">
                تسجيل دفعة
              </Link>
            )}
            <Link href={mine ? "/collections?view=list" : "/collections?view=list&mine=1"} className="btn btn-outline btn-sm">
              {mine ? "كل المطالبات" : "مطالباتي"}
            </Link>
            <MoreMenu
              items={[
                { label: "حسب العقار", href: "/collections" },
                { label: "وعود مكسورة", href: "/collections?view=list&followUpStatus=BROKEN_PROMISE" },
                { label: "مطالبات مصعّدة", href: "/collections?view=list&followUpStatus=ESCALATED" },
                { label: "جدول الدفعات", href: "/installments" },
                { label: "سندات القبض", href: "/payments" },
              ]}
            />
          </>
        }
      />

      <StatGrid cols={4}>
        <StatCard label="مطالبات مفتوحة" value={money(openCases.length)} />
        <StatCard label="إجمالي المتأخر" value={money(overdueTotal)} tone={overdueTotal > 0 ? "danger" : undefined} />
        <StatCard label="وعود تستحق اليوم" value={money(promisesToday)} tone={promisesToday > 0 ? "warning" : undefined} href="/collections?view=list&followUpStatus=PROMISE_TO_PAY" />
        <StatCard label="نسبة التحصيل هذا الشهر" value={pct(rate)} sub={`${money(monthPaid)} من ${money(monthDue)} ر.س`} dark />
      </StatGrid>

      <Card className="mt-4" padded={false}>
        <div className="px-4 pt-4">
          <FilterBar base="/collections" hasFilters={hasFilters}>
            <input type="hidden" name="view" value="list" />
            {mine && <input type="hidden" name="mine" value="1" />}
            <Input name="q" placeholder="اسم المستأجر أو الجوال" defaultValue={sp.q ?? ""} className="!w-52" />
            <Select name="followUpStatus" options={COLLECTION_STATUS} placeholder="الحالة" defaultValue={sp.followUpStatus ?? ""} className="!w-44" />
            <Select name="collectorId" options={collectors.map((c) => ({ value: c.id, label: c.name }))} placeholder="كل المحصلين" defaultValue={sp.collectorId ?? ""} className="!w-40" />
            <MoreFilters open={Boolean(sp.propertyId || sp.bucket || sp.minAmount)}>
              <Select name="propertyId" options={properties.map((p) => ({ value: p.id, label: p.name }))} placeholder="كل العقارات" defaultValue={sp.propertyId ?? ""} className="!w-44" />
              <Select name="bucket" options={AGING_BUCKETS.map((b) => ({ value: b.key, label: b.label }))} placeholder="كل فترات التأخر" defaultValue={sp.bucket ?? ""} className="!w-40" />
              <Input name="minAmount" type="number" min={0} step="100" placeholder="الحد الأدنى للمبلغ" defaultValue={sp.minAmount ?? ""} className="!w-36" />
            </MoreFilters>
          </FilterBar>
        </div>

        {(views.length > 0 || hasFilters) && (
          <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-2.5 text-[12.5px]">
            {views.length > 0 && <span className="font-bold text-muted">عروض محفوظة:</span>}
            {views.map((v) => (
              <span key={v.id} className="inline-flex items-center gap-1">
                <Link href={`/collections?view=list${v.query ? `&${v.query}` : ""}`} className={`btn btn-xs ${v.query === query ? "btn-primary" : "btn-outline"}`}>
                  {v.name}
                  {v.isShared && <span className="text-[10px] opacity-70"> · مشترك</span>}
                </Link>
                {v.userId === user.id && (
                  <ActionButton action={deleteView} hidden={{ id: v.id }} className="btn btn-ghost btn-xs !px-1.5" confirm="حذف هذا العرض؟">
                    ×
                  </ActionButton>
                )}
              </span>
            ))}
            {hasFilters && (
              <form action={saveView} className="mr-auto flex items-center gap-1.5">
                <input type="hidden" name="query" value={query} />
                <Input name="name" placeholder="اسم العرض" className="!h-8 !w-40 !text-xs" required />
                <label className="flex items-center gap-1 text-[12px] text-muted">
                  <input type="checkbox" name="isShared" value="1" /> مشترك
                </label>
                <button type="submit" className="btn btn-ghost btn-xs">
                  حفظ العرض
                </button>
              </form>
            )}
          </div>
        )}

        {rows.length === 0 ? (
          <EmptyState
            title={hasFilters ? "لا توجد مطالبات مطابقة" : "لا توجد مطالبات مفتوحة"}
            description={hasFilters ? "جرّب تعديل الفلاتر." : "تُفتح المطالبات تلقائيًا عند تأخر أي قسط عن موعده."}
            action={hasFilters ? <Link href="/collections?view=list" className="btn btn-outline">مسح الفلاتر</Link> : <Link href="/collections" className="btn btn-outline">التحصيل حسب العقار</Link>}
          />
        ) : (
          <form action={bulkAssign}>
            <input type="hidden" name="back" value={currentUrl} />
            {canManage && (
              <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-2.5 text-[13px]">
                <span className="text-muted">إسناد المحدد إلى:</span>
                <Select name="collectorId" options={collectors.map((c) => ({ value: c.id, label: c.name }))} placeholder="اختر المحصل" className="!h-8 !w-48 !text-xs" required />
                <button type="submit" className="btn btn-outline btn-xs">
                  إسناد
                </button>
              </div>
            )}
            <Table>
              <thead>
                <tr>
                  {canManage && <th className="w-8"></th>}
                  <th>المستأجر</th>
                  <th className="num">المتبقي</th>
                  <th>التأخر</th>
                  <th>الحالة</th>
                  <th>المتابعة</th>
                  <th>المحصل</th>
                  <th className="num">الأولوية</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((k) => {
                  const inst = k.installment;
                  const remaining = inst.amount - inst.paidAmount;
                  const late = daysOverdue(inst.dueDate);
                  const last = k.actions[0];
                  const promiseLate = k.promiseDate && k.promiseDate < now && k.followUpStatus === "PROMISE_TO_PAY";
                  const nextDue = k.nextActionDate && k.nextActionDate <= now;
                  return (
                    <tr key={k.id}>
                      {canManage && (
                        <td>
                          <input type="checkbox" name="ids" value={k.id} aria-label={`تحديد ${inst.tenant.name}`} />
                        </td>
                      )}
                      <td>
                        <Link href={`/collections/${k.id}`} className="cell-primary hover:text-brand">
                          {inst.tenant.name}
                        </Link>
                        <div className="cell-sub">
                          <span className="latin">{inst.contract.unit.number}</span> · {inst.contract.property.name}
                          {inst.tenant.phone && <span className="num"> · {displayPhone(inst.tenant.phone)}</span>}
                        </div>
                      </td>
                      <td className="num font-bold">
                        {money(remaining)}
                        {inst.paidAmount > 0 && <div className="cell-sub num">من {money(inst.amount)}</div>}
                      </td>
                      <td>
                        <span className={`num ${late > 30 ? "text-danger font-bold" : ""}`}>{late}</span> يوم
                        <div className="cell-sub">{date(inst.dueDate)}</div>
                      </td>
                      <td>
                        <StatusTag value={k.followUpStatus} map={COLLECTION_STATUS} />
                        {k.promiseDate && (
                          <div className={`cell-sub ${promiseLate ? "text-danger" : ""}`}>
                            وعد {date(k.promiseDate)}
                            {k.promiseAmount ? <span className="num"> · {money(k.promiseAmount)}</span> : null}
                          </div>
                        )}
                      </td>
                      <td className="text-[12.5px]">
                        {k.nextAction ?? (k.followUpStatus === "OPEN" && !k.lastActionAt ? "بدء التواصل" : "—")}
                        {k.nextActionDate && <span className={`cell-sub ${nextDue ? "text-warning" : ""}`}> · {relative(k.nextActionDate)}</span>}
                        <div className="cell-sub">{last ? `آخر إجراء: ${COLLECTION_ACTION_TYPES[last.type] ?? last.type} · ${relative(last.createdAt)}` : "لا يوجد إجراء بعد"}</div>
                      </td>
                      <td className="text-muted">{k.collector?.name ?? <Tag tone="warning" plain>غير مسندة</Tag>}</td>
                      <td className="num">
                        <PriorityPill v={k.priority} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </form>
        )}
        <Pagination page={page} pageSize={PAGE} total={total} base="/collections" params={{ ...sp, view: "list" }} />
      </Card>
    </>
  );
}
