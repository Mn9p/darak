import Link from "next/link";
import { Suspense } from "react";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { runEngineThrottled } from "@/lib/engine";
import { propertyIdScope, contractScope, can, isScoped, type Permission } from "@/lib/permissions";
import { propertyCollectionBoard } from "@/lib/collections";
import { money, pct, date, dateHijri, daysOverdue, daysFromToday, relative, startOfMonth, endOfMonth, addDays, num, startOfDay, endOfDay } from "@/lib/format";
import { COLLECTION_STATUS } from "@/lib/constants";
import { PageHeader, StatCard, StatGrid, Card, StatusTag, Progress, Table, EmptyState, Tag, PriorityPill } from "@/components/ui";
import { AssistantCardSkeleton } from "@/components/AssistantCard";
import { DailyBrief } from "./DailyBrief";
import { FirstSteps } from "@/components/FirstSteps";
import { displayPhone } from "@/lib/phone";

export const dynamic = "force-dynamic";

const ACTIVE = ["ACTIVE", "EXPIRING_SOON", "RENEWAL_PENDING"];
const OPEN_CASE = ["OPEN", "PROMISE_TO_PAY", "BROKEN_PROMISE", "DISPUTED", "ESCALATED"];

export default async function DashboardPage() {
  const user = await requireStaff();
  await runEngineThrottled(user.organizationId);
  if (user.role === "COLLECTOR") return <CollectorDashboard org={user.organizationId} userId={user.id} name={user.name} />;
  return <ManagerDashboard user={user} />;
}

/* ─────────────────────────── Manager / default ───────────────────────────
   One screen, three questions a property-office manager asks every morning:
   1. Where is the money?      collected vs due, overdue, owed to owners, empty units
   2. What must I do today?    promises, follow-ups, renewals, approvals, next week's due
   3. Which property hurts?    property board, worst first                                             */

async function ManagerDashboard({ user }: { user: Awaited<ReturnType<typeof requireStaff>> }) {
  const org = user.organizationId;
  const pidScope = propertyIdScope(user);
  const cScope = contractScope(user);
  const now = new Date();
  const dayStart = startOfDay(now);
  const dayEnd = endOfDay(now);
  const caseScope = cScope.contract ? { installment: { contract: cScope.contract } } : {};

  const [board, units, vacantUnits, ownerDue, promisesToday, followUpsToday, unassigned, broken, expiring30, expiringList, dueWeek, pendingExpenses, statementsReview, docsExpiring, topCases, myTasks, propertyCount, ownerCount, contractCount] = await Promise.all([
    propertyCollectionBoard(user),
    db.unit.groupBy({ by: ["status"], where: { organizationId: org, status: { not: "ARCHIVED" }, ...pidScope }, _count: true }),
    db.unit.findMany({ where: { organizationId: org, status: { in: ["VACANT", "AVAILABLE"] }, ...pidScope }, select: { targetRent: true, currentRent: true } }),
    db.ownerStatement.aggregate({ where: { organizationId: org, status: "APPROVED" }, _sum: { netDue: true }, _count: true }),
    db.collectionCase.count({ where: { organizationId: org, followUpStatus: "PROMISE_TO_PAY", promiseDate: { gte: dayStart, lte: dayEnd }, ...caseScope } }),
    db.collectionCase.count({ where: { organizationId: org, followUpStatus: { in: ["OPEN", "PROMISE_TO_PAY", "BROKEN_PROMISE", "DISPUTED"] }, nextActionDate: { lte: dayEnd }, ...caseScope } }),
    db.collectionCase.count({ where: { organizationId: org, followUpStatus: { in: OPEN_CASE }, collectorId: null, ...caseScope } }),
    db.collectionCase.count({ where: { organizationId: org, followUpStatus: "BROKEN_PROMISE", ...caseScope } }),
    db.contract.count({ where: { organizationId: org, status: { in: ACTIVE }, endDate: { lte: addDays(now, 30) }, renewalStatus: null, ...pidScope } }),
    db.contract.findMany({ where: { organizationId: org, status: { in: ACTIVE }, endDate: { lte: addDays(now, 90) }, ...pidScope }, orderBy: { endDate: "asc" }, take: 6, include: { tenant: { select: { name: true } }, unit: { select: { number: true } }, property: { select: { name: true } } } }),
    db.installment.aggregate({ where: { organizationId: org, status: "UPCOMING", dueDate: { lte: addDays(now, 7) }, ...cScope }, _sum: { amount: true }, _count: true }),
    db.expense.count({ where: { organizationId: org, approvalStatus: "PENDING", ...pidScope } }),
    db.ownerStatement.count({ where: { organizationId: org, status: "UNDER_REVIEW" } }),
    db.document.count({ where: { organizationId: org, expiryDate: { gte: dayStart, lte: addDays(now, 30) } } }),
    db.collectionCase.findMany({
      where: { organizationId: org, followUpStatus: { in: OPEN_CASE }, ...caseScope },
      orderBy: { priority: "desc" },
      take: 6,
      include: { installment: { include: { tenant: { select: { name: true } }, contract: { select: { unit: { select: { number: true } }, property: { select: { id: true, name: true } } } } } }, collector: { select: { name: true } } },
    }),
    db.task.findMany({ where: { organizationId: org, assignedToId: user.id, status: { notIn: ["COMPLETED", "CANCELLED"] } }, orderBy: [{ dueDate: "asc" }], take: 5 }),
    db.property.count({ where: { organizationId: org } }),
    db.owner.count({ where: { organizationId: org } }),
    db.contract.count({ where: { organizationId: org, status: { in: ACTIVE } } }),
  ]);
  const totalUnits = units.reduce((a, b) => a + b._count, 0);
  // First run = nothing is live yet (no property, or no active contract). Draft contracts do not count.
  const firstRun = propertyCount === 0 || contractCount === 0;

  if (firstRun) {
    return (
      <>
        <PageHeader
          title={`${greeting()}، ${user.name.split(" ")[0]}`}
          subtitle={`${date(now)} · ${dateHijri(now)}`}
          actions={
            can(user, "contracts.manage") && propertyCount > 0 ? (
              <Link href="/contracts/new" className="btn btn-primary btn-sm">
                عقد جديد
              </Link>
            ) : undefined
          }
        />
        <FirstSteps
          owners={ownerCount}
          properties={propertyCount}
          units={totalUnits}
          contracts={contractCount}
          can={{ owners: can(user, "owners.manage"), properties: can(user, "properties.manage"), units: can(user, "units.manage"), contracts: can(user, "contracts.manage"), import: can(user, "import.manage"), settings: can(user, "settings.manage") }}
        />
      </>
    );
  }

  const rented = units.filter((u) => u.status === "RENTED").reduce((a, b) => a + b._count, 0);
  const occupancy = totalUnits ? (rented / totalUnits) * 100 : 0;
  const vacant = vacantUnits.length;
  const lostRentMonthly = vacantUnits.reduce((s, u) => s + (u.targetRent ?? u.currentRent ?? 0) / 12, 0);
  const { totals, rows } = board;
  const overdueCount = rows.reduce((s, r) => s + r.overdueCount, 0);
  const rate = totals.dueMonth ? (totals.paidMonth / totals.dueMonth) * 100 : 0;
  const worst = rows
    .filter((r) => r.overdueAmt > 0 || r.dueMonth > 0)
    .sort((a, b) => b.overdueAmt - a.overdueAmt || a.rate - b.rate)
    .slice(0, 6);

  // Today's work: only rows with something in them.
  type TodayRow = { label: string; count: number; hint?: string; href: string; tone: "danger" | "warning" | "info"; perm: Permission };
  const todayRows: TodayRow[] = [
    { label: "وعود سداد تستحق اليوم", count: promisesToday, href: "/collections?view=list&followUpStatus=PROMISE_TO_PAY", tone: "warning", perm: "collections.view" },
    { label: "متابعات تحصيل مجدولة لليوم أو متأخرة", count: followUpsToday, href: "/collections?view=list", tone: "warning", perm: "collections.view" },
    { label: "وعود مكسورة", count: broken, hint: "تواصل أو صعّد", href: "/collections?view=list&followUpStatus=BROKEN_PROMISE", tone: "danger", perm: "collections.view" },
    { label: "مطالبات بلا محصل", count: unassigned, hint: "أسندها", href: "/collections?view=list", tone: "warning", perm: "collections.manage" },
    { label: "عقود تنتهي خلال 30 يومًا بلا قرار تجديد", count: expiring30, href: "/contracts?expiring=30", tone: "danger", perm: "contracts.view" },
    { label: "دفعات تستحق خلال 7 أيام", count: dueWeek._count, hint: `${money(dueWeek._sum.amount ?? 0)} ر.س`, href: "/installments?status=UPCOMING", tone: "info", perm: "installments.view" },
    { label: "مصروفات بانتظار الاعتماد", count: pendingExpenses, href: "/expenses?approval=PENDING", tone: "info", perm: "expenses.approve" },
    { label: "كشوف حساب ملاك قيد المراجعة", count: statementsReview, href: "/statements?status=UNDER_REVIEW", tone: "info", perm: "statements.view" },
    { label: "مستندات تنتهي خلال 30 يومًا", count: docsExpiring, href: "/documents?expiring=30", tone: "info", perm: "documents.view" },
  ];
  const today = todayRows.filter((r) => r.count > 0 && can(user, r.perm));
  const seeCollections = can(user, "collections.view");
  // Owner payouts are office-wide figures: only for roles that see statements and are not limited to some properties.
  const seeOwnerDue = can(user, "statements.view") && !isScoped(user);

  return (
    <>
      <PageHeader
        title={`${greeting()}، ${user.name.split(" ")[0]}`}
        subtitle={`${date(now)} · ${dateHijri(now)}`}
        actions={
          <>
            {can(user, "contracts.manage") && (
              <Link href="/contracts/new" className="btn btn-outline btn-sm">
                عقد جديد
              </Link>
            )}
            {can(user, "payments.manage") && (
              <Link href="/payments/new" className="btn btn-primary btn-sm">
                تسجيل سند قبض
              </Link>
            )}
          </>
        }
      />

      {/* 1. Where is the money */}
      <StatGrid cols={4}>
        <StatCard
          label="المحصل هذا الشهر"
          value={totals.dueMonth ? money(totals.paidMonth) : "—"}
          sub={
            totals.dueMonth ? (
              <span>
                من {money(totals.dueMonth)} ر.س مستحقة
                <Progress value={rate} tone={rate < 60 ? "danger" : rate < 85 ? "warn" : undefined} />
              </span>
            ) : (
              "لا مستحقات هذا الشهر"
            )
          }
          href={seeCollections ? "/collections" : undefined}
          tone={totals.dueMonth && rate < 75 ? "warning" : undefined}
        />
        <StatCard label="المتأخر" value={money(totals.overdueAmt)} sub={overdueCount ? `${num(overdueCount)} دفعة${totals.enforceable ? ` · ${num(totals.enforceable)} تجاوزت المهلة` : ""}` : "لا توجد متأخرات"} tone={totals.overdueAmt > 0 ? "danger" : undefined} href={seeCollections ? "/collections" : undefined} />
        {seeOwnerDue ? (
          <StatCard label="مستحق تحويله للملاك" value={money(ownerDue._sum.netDue ?? 0)} sub={ownerDue._count ? `${num(ownerDue._count)} كشف حساب معتمد` : "لا كشوف معتمدة بانتظار التحويل"} href="/statements?status=APPROVED" />
        ) : (
          <StatCard label="عقود تنتهي خلال 30 يومًا" value={num(expiring30)} sub="بلا قرار تجديد" tone={expiring30 > 0 ? "warning" : undefined} href={can(user, "contracts.view") ? "/contracts?expiring=30" : undefined} />
        )}
        <StatCard
          label="وحدات شاغرة"
          value={totalUnits ? `${num(vacant)} / ${num(totalUnits)}` : "—"}
          sub={!totalUnits ? "لا توجد وحدات مسجلة" : vacant ? `إيجار مفقود ≈ ${money(lostRentMonthly)} ر.س شهريًا · إشغال ${pct(occupancy, 0)}` : `إشغال ${pct(occupancy, 0)}`}
          tone={vacant > 0 ? "warning" : undefined}
          href={can(user, "units.view") ? "/units?status=VACANT" : undefined}
          dark
        />
      </StatGrid>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        {/* 2. What must I do today */}
        <Card title="عمل اليوم" subtitle={today.length ? `${num(today.length)} بند` : undefined} padded={false} className="xl:col-span-2">
          {today.length === 0 ? (
            <EmptyState title="لا شيء عالق اليوم" description="الوعود والمتابعات والاعتمادات كلها منجزة." />
          ) : (
            <ul className="divide-y divide-line">
              {today.map((r) => (
                <li key={r.label}>
                  <Link href={r.href} className="flex items-center justify-between gap-3 px-5 py-3 text-[13.5px] hover:bg-mist">
                    <span className="min-w-0">
                      <span className="font-semibold">{r.label}</span>
                      {r.hint && <span className="mr-2 text-[12.5px] text-muted">{r.hint}</span>}
                    </span>
                    <Tag tone={r.tone}>
                      <span className="num">{r.count}</span>
                    </Tag>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Suspense fallback={<AssistantCardSkeleton title="ملخص اليوم" tone="dark" />}>
          <DailyBrief user={user} expiring30={expiring30} vacant={vacant} pendingExpenses={pendingExpenses} brokenPromises={broken} />
        </Suspense>
      </div>

      {/* 3. Which property hurts */}
      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card title="العقارات" subtitle="الأسوأ تحصيلًا أولًا" actions={seeCollections ? <Link href="/collections" className="link text-xs">كل العقارات</Link> : undefined} className="xl:col-span-2" padded={false}>
          {worst.length === 0 ? (
            <EmptyState title="لا توجد مستحقات هذا الشهر" />
          ) : (
            <Table density="compact">
              <thead>
                <tr>
                  <th>العقار</th>
                  <th>تحصيل الشهر</th>
                  <th className="num">المتأخر</th>
                  <th>المتابعة</th>
                </tr>
              </thead>
              <tbody>
                {worst.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <Link href={`/properties/${r.id}?tab=collections`} className="cell-primary hover:text-brand">
                        {r.name}
                      </Link>
                      <div className="cell-sub">
                        <span className="num">{r.units.rented}</span>/<span className="num">{r.units.total}</span> وحدة مؤجرة
                      </div>
                    </td>
                    <td>
                      <div className="flex items-center gap-2">
                        <div className="w-20">
                          <Progress value={r.rate} tone={r.dueMonth && r.rate < 60 ? "danger" : r.dueMonth && r.rate < 85 ? "warn" : undefined} />
                        </div>
                        <span className="num text-[12.5px]">{r.dueMonth ? `${Math.round(r.rate)}%` : "—"}</span>
                      </div>
                    </td>
                    <td className={`num font-bold ${r.overdueAmt > 0 ? "text-danger" : "text-muted"}`}>
                      {r.overdueAmt > 0 ? money(r.overdueAmt) : "—"}
                      {r.overdueCount > 0 && <div className="cell-sub num">{r.overdueCount} دفعة · أقدمها {r.oldestLate} يوم</div>}
                    </td>
                    <td className="text-[12.5px]">
                      {r.enforceable > 0 && <div className="text-warning">تجاوزت المهلة: <b className="num">{r.enforceable}</b></div>}
                      {r.broken > 0 && <div className="text-danger">وعود مكسورة: <b className="num">{r.broken}</b></div>}
                      {r.unassigned > 0 && <div className="text-warning">بلا محصل: <b className="num">{r.unassigned}</b></div>}
                      {!r.enforceable && !r.broken && !r.unassigned && <span className="text-faint">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <div className="space-y-4">
          <Card title="عقود تنتهي خلال 90 يومًا" actions={can(user, "contracts.view") ? <Link href="/contracts?expiring=90" className="link text-xs">الكل</Link> : undefined} padded={false}>
            {expiringList.length === 0 ? (
              <EmptyState title="لا توجد عقود تنتهي قريبًا" />
            ) : (
              <ul className="divide-y divide-line">
                {expiringList.map((c) => {
                  const left = daysFromToday(c.endDate);
                  return (
                    <li key={c.id} className="flex items-center justify-between gap-3 px-5 py-2.5 text-[13px]">
                      <div className="min-w-0">
                        <Link href={`/contracts/${c.id}?tab=renewal`} className="block truncate font-bold hover:text-brand">
                          {c.tenant.name}
                        </Link>
                        <div className="truncate text-[12px] text-muted">
                          {c.property.name} · <span className="latin">{c.unit.number}</span>
                          {!c.renewalStatus && <span className="text-warning"> · بلا قرار</span>}
                        </div>
                      </div>
                      <Tag tone={left <= 30 ? "danger" : left <= 60 ? "warning" : "info"} plain>
                        <span className="num">{left}</span> يوم
                      </Tag>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
          {myTasks.length > 0 && (
            <Card title="مهامي" actions={<Link href="/tasks" className="link text-xs">الكل</Link>} padded={false}>
              <ul className="divide-y divide-line">
                {myTasks.map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-2 px-5 py-2.5 text-[13px]">
                    <Link href={`/tasks/${t.id}`} className="truncate hover:text-brand">
                      {t.title}
                    </Link>
                    <span className={`shrink-0 text-[11.5px] ${t.dueDate && t.dueDate < now ? "text-danger" : "text-muted"}`}>{relative(t.dueDate)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>

      {topCases.length > 0 && (
        <Card title="أولويات التحصيل" subtitle="ابدأ بهؤلاء" actions={seeCollections ? <Link href="/collections?view=list" className="link text-xs">كل المطالبات</Link> : undefined} className="mt-4" padded={false}>
          <Table density="compact">
            <thead>
              <tr>
                <th>المستأجر</th>
                <th>العقار / الوحدة</th>
                <th className="num">المتبقي</th>
                <th>التأخر</th>
                <th>الحالة</th>
                <th>المحصل</th>
                <th className="num">الأولوية</th>
              </tr>
            </thead>
            <tbody>
              {topCases.map((k) => (
                <tr key={k.id}>
                  <td>
                    <Link className="cell-primary hover:text-brand" href={`/collections/${k.id}`}>
                      {k.installment.tenant.name}
                    </Link>
                  </td>
                  <td>
                    <Link href={`/properties/${k.installment.contract.property.id}?tab=collections`} className="hover:text-brand">
                      {k.installment.contract.property.name}
                    </Link>
                    <span className="latin text-muted"> · {k.installment.contract.unit.number}</span>
                  </td>
                  <td className="num font-bold">{money(k.installment.amount - k.installment.paidAmount)}</td>
                  <td>
                    <span className="num">{daysOverdue(k.installment.dueDate)}</span> يوم
                  </td>
                  <td>
                    <StatusTag value={k.followUpStatus} map={COLLECTION_STATUS} />
                  </td>
                  <td className="text-muted">{k.collector?.name ?? <Tag tone="warning" plain>بلا محصل</Tag>}</td>
                  <td className="num">
                    <PriorityPill v={k.priority} />
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </>
  );
}

/* ─────────────────────────── Collector ─────────────────────────── */

async function CollectorDashboard({ org, userId, name }: { org: string; userId: string; name: string }) {
  const now = new Date();
  const [cases, collected] = await Promise.all([
    db.collectionCase.findMany({
      where: { organizationId: org, collectorId: userId, followUpStatus: { in: OPEN_CASE } },
      orderBy: { priority: "desc" },
      include: { installment: { include: { tenant: { select: { name: true, phone: true } }, contract: { select: { code: true, unit: { select: { number: true } }, property: { select: { id: true, name: true } } } } } } },
    }),
    db.payment.aggregate({ where: { organizationId: org, recordedById: userId, paidAt: { gte: startOfMonth(now), lte: endOfMonth(now) }, status: { in: ["RECORDED", "APPROVED"] } }, _sum: { amount: true } }),
  ]);
  const todayCases = cases.filter((c) => (c.nextActionDate && c.nextActionDate <= now) || (c.promiseDate && daysFromToday(c.promiseDate) <= 0) || !c.lastActionAt);
  const overdueAmt = cases.reduce((s, c) => s + (c.installment.amount - c.installment.paidAmount), 0);
  const promises = cases.filter((c) => c.followUpStatus === "PROMISE_TO_PAY").length;
  const broken = cases.filter((c) => c.followUpStatus === "BROKEN_PROMISE").length;

  return (
    <>
      <PageHeader title={`${greeting()}، ${name.split(" ")[0]}`} subtitle={`${date(now)} · ${dateHijri(now)}`} actions={<Link href="/payments/new" className="btn btn-primary btn-sm">تسجيل سند قبض</Link>} />
      <StatGrid cols={4}>
        <StatCard label="للمتابعة اليوم" value={num(todayCases.length)} tone={todayCases.length ? "warning" : undefined} sub="وعود ومتابعات مجدولة وحالات لم يُتواصل معها" />
        <StatCard label="المتأخر في مطالباتي" value={money(overdueAmt)} tone={overdueAmt > 0 ? "danger" : undefined} sub={`${num(cases.length)} مطالبة مفتوحة`} />
        <StatCard label="وعود سداد قائمة" value={num(promises)} sub={broken ? `${num(broken)} مكسورة` : "لا وعود مكسورة"} tone={broken ? "danger" : undefined} />
        <StatCard label="حصّلته هذا الشهر" value={money(collected._sum.amount ?? 0)} dark />
      </StatGrid>
      <Card title="ابدأ بهؤلاء" subtitle="مطالباتك مرتبة حسب الأولوية" className="mt-4" padded={false} actions={<Link href="/collections?view=list&mine=1" className="link text-xs">كل مطالباتي</Link>}>
        {cases.length === 0 ? (
          <EmptyState title="لا توجد مطالبات مسندة إليك" description="تُسند المطالبات تلقائيًا عند تأخر أي دفعة." />
        ) : (
          <Table density="compact">
            <thead>
              <tr>
                <th>المستأجر</th>
                <th>العقار / الوحدة</th>
                <th className="num">المتبقي</th>
                <th>التأخر</th>
                <th>الحالة</th>
                <th>الإجراء التالي</th>
                <th className="num">الأولوية</th>
              </tr>
            </thead>
            <tbody>
              {cases.slice(0, 25).map((k) => (
                <tr key={k.id}>
                  <td>
                    <Link href={`/collections/${k.id}`} className="cell-primary hover:text-brand">
                      {k.installment.tenant.name}
                    </Link>
                    <div className="cell-sub num">{displayPhone(k.installment.tenant.phone)}</div>
                  </td>
                  <td>
                    <Link href={`/properties/${k.installment.contract.property.id}?tab=collections`} className="hover:text-brand">
                      {k.installment.contract.property.name}
                    </Link>
                    <div className="cell-sub latin">{k.installment.contract.unit.number}</div>
                  </td>
                  <td className="num font-bold">{money(k.installment.amount - k.installment.paidAmount)}</td>
                  <td>
                    <span className="num">{daysOverdue(k.installment.dueDate)}</span> يوم
                  </td>
                  <td>
                    <StatusTag value={k.followUpStatus} map={COLLECTION_STATUS} />
                  </td>
                  <td className="text-[12.5px]">
                    {k.nextAction ?? (k.promiseDate ? `متابعة الوعد ${relative(k.promiseDate)}` : k.lastActionAt ? "—" : "بدء التواصل")}
                    {k.nextActionDate && <div className={`cell-sub ${k.nextActionDate <= now ? "text-warning" : ""}`}>{relative(k.nextActionDate)}</div>}
                  </td>
                  <td className="num">
                    <PriorityPill v={k.priority} />
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "صباح الخير" : "مساء الخير";
}
