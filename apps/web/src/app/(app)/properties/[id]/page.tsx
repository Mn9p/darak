import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { can, propertyScope } from "@/lib/permissions";
import { PROPERTY_TYPES, PROPERTY_STATUS, UNIT_STATUS, UNIT_TYPES, CONTRACT_STATUS, INSTALLMENT_STATUS, EXPENSE_CATEGORIES, APPROVAL_STATUS, TASK_STATUS, TASK_PRIORITY, DOCUMENT_TYPES, AUDIT_ACTIONS, RISK_LEVELS } from "@/lib/constants";
import { money, pct, date, datetime, num, daysFromToday, safeJson, tagsToArray, startOfMonth, endOfMonth, startOfYear, ksaParts, ksaDate, addDays } from "@/lib/format";
import { HeroHeader, Card, Table, StatusTag, Tabs, DL, StatGrid, StatCard, Progress, EmptyState, Tag, ActionButton, KV } from "@/components/ui";
import { MoreMenu } from "@/components/MoreMenu";
import { archiveProperty, restoreProperty } from "../actions";
import { CollectionsTab } from "./CollectionsTab";
import { PropertyBrief } from "./PropertyBrief";
import { AssistantCardSkeleton } from "@/components/AssistantCard";
import { Suspense } from "react";
import { Optional } from "@/components/MoreMenu";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "overview", label: "نظرة عامة" },
  { key: "units", label: "الوحدات" },
  { key: "contracts", label: "العقود" },
  { key: "collections", label: "التحصيل" },
  { key: "expenses", label: "المصروفات" },
  { key: "financials", label: "المالية" },
  { key: "documents", label: "المستندات" },
  { key: "activity", label: "سجل العمليات" },
];

export default async function PropertyPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; f?: string; unitId?: string }> }) {
  const user = await requireStaff();
  const { id } = await params;
  const { tab = "overview", f, unitId } = await searchParams;
  const org = user.organizationId;

  const p = await db.property.findFirst({
    where: { id, organizationId: org, ...propertyScope(user) },
    include: {
      branch: true,
      manager: { select: { id: true, name: true } },
      ownerships: { include: { owner: { select: { id: true, name: true, phone: true, managementFeePct: true } } }, orderBy: { startDate: "desc" } },
      units: { orderBy: { number: "asc" }, include: { contracts: { where: { status: { in: ["ACTIVE", "EXPIRING_SOON", "RENEWAL_PENDING"] } }, take: 1, include: { tenant: { select: { id: true, name: true } } } } } },
    },
  });
  if (!p) notFound();

  const activeUnits = p.units.filter((u) => u.status !== "ARCHIVED");
  const rented = activeUnits.filter((u) => u.status === "RENTED").length;
  const occupancy = activeUnits.length ? (rented / activeUnits.length) * 100 : 0;
  const annualRent = activeUnits.reduce((s, u) => s + (u.currentRent ?? 0), 0);
  const currentOwners = p.ownerships.filter((o) => !o.endDate);
  const historicalOwners = p.ownerships.filter((o) => o.endDate);

  const now = new Date();
  const [overdueInst, ytdPayments, ytdExpenses, openTasks, expiring, pendingExp, openClaims] = await Promise.all([
    db.installment.aggregate({ where: { contract: { propertyId: id }, status: { in: ["OVERDUE", "PARTIALLY_PAID"] } }, _sum: { amount: true, paidAmount: true }, _count: true }),
    db.paymentAllocation.aggregate({ where: { installment: { contract: { propertyId: id } }, payment: { paidAt: { gte: startOfYear() }, status: { in: ["RECORDED", "APPROVED"] } } }, _sum: { amount: true } }),
    db.expense.aggregate({ where: { propertyId: id, approvalStatus: "APPROVED", date: { gte: startOfYear() } }, _sum: { amount: true, vatAmount: true } }),
    db.task.findMany({ where: { organizationId: org, entityType: "PROPERTY", entityId: id, status: { notIn: ["COMPLETED", "CANCELLED"] } }, orderBy: { dueDate: "asc" }, take: 5, include: { assignedTo: { select: { name: true } } } }),
    db.contract.findMany({ where: { organizationId: org, propertyId: id, status: { in: ["ACTIVE", "EXPIRING_SOON", "RENEWAL_PENDING"] }, endDate: { lte: addDays(now, 60) } }, orderBy: { endDate: "asc" }, take: 5, include: { tenant: { select: { name: true } }, unit: { select: { number: true } } } }),
    db.expense.count({ where: { organizationId: org, propertyId: id, approvalStatus: "PENDING" } }),
    db.installment.findMany({ where: { organizationId: org, status: { in: ["OVERDUE", "PARTIALLY_PAID", "DUE"] }, contract: { propertyId: id } }, orderBy: { dueDate: "asc" }, take: 5, include: { tenant: { select: { id: true, name: true } }, contract: { select: { unit: { select: { number: true } } } }, collectionCase: { select: { id: true } } } }),
  ]);
  const feePct = currentOwners.reduce((s, o) => s + (o.owner.managementFeePct * o.percentage) / 100, 0);
  const ytdFees = (ytdPayments._sum.amount ?? 0) * (feePct / 100);
  const attention: { label: string; sub: string; href: string; tone: "danger" | "warning" | "info" }[] = [
    ...openClaims.map((i) => ({ label: `${i.tenant.name} — ${money(i.amount - i.paidAmount)} ر.س`, sub: `وحدة ${i.contract.unit.number} · ${daysFromToday(i.dueDate) < 0 ? `متأخر ${-daysFromToday(i.dueDate)} يوم` : "يستحق اليوم"}`, href: `/properties/${id}?tab=collections`, tone: "danger" as const })),
    ...expiring.map((c) => ({ label: `عقد ${c.tenant.name} ينتهي ${date(c.endDate)}`, sub: `وحدة ${c.unit.number} · بعد ${daysFromToday(c.endDate)} يوم`, href: `/contracts/${c.id}`, tone: "warning" as const })),
    ...(pendingExp > 0 ? [{ label: `${pendingExp} مصروف بانتظار الاعتماد`, sub: "بحاجة لقرار", href: `/expenses?approval=PENDING&propertyId=${id}`, tone: "info" as const }] : []),
  ];
  const overdueAmt = (overdueInst._sum.amount ?? 0) - (overdueInst._sum.paidAmount ?? 0);
  const ytdIncome = ytdPayments._sum.amount ?? 0;
  const ytdExp = (ytdExpenses._sum.amount ?? 0) + (ytdExpenses._sum.vatAmount ?? 0);
  const cf = safeJson<Record<string, string>>(p.customFields, {});

  return (
    <>
      <HeroHeader
        title={p.name}
        code={p.code}
        status={
          <>
            <StatusTag value={p.status} map={PROPERTY_STATUS} />
            {tagsToArray(p.tags).map((t) => (
              <Tag key={t} tone="brand" plain>
                {t}
              </Tag>
            ))}
          </>
        }
        meta={[
          <span key="type">{PROPERTY_TYPES[p.type]}</span>,
          p.city && (
            <span key="loc">
              {p.city}
              {p.district ? ` — ${p.district}` : ""}
            </span>
          ),
          p.manager && (
            <span key="mgr">
              مدير العقار: <Link className="link" href={`/employees/${p.manager.id}`}>{p.manager.name}</Link>
            </span>
          ),
          currentOwners.length > 0 && (
            <span key="own">
              المالك: <Link className="link" href={`/owners/${currentOwners[0].owner.id}`}>{currentOwners[0].owner.name}</Link>
              {currentOwners.length > 1 && <span className="text-faint"> +{currentOwners.length - 1}</span>}
            </span>
          ),
        ]}
        breadcrumbs={[{ label: "العقارات", href: "/properties" }, { label: p.name }]}
        actions={
          <>
            {can(user, "units.manage") && (
              <Link href={`/units/new?propertyId=${p.id}`} className="btn btn-outline btn-sm">
                إضافة وحدة
              </Link>
            )}
            {can(user, "properties.manage") && (
              <Link href={`/properties/${p.id}/edit`} className="btn btn-primary btn-sm">
                تعديل
              </Link>
            )}
            <MoreMenu
              items={[
                can(user, "contracts.manage") && { label: "عقد جديد لهذا العقار", href: `/contracts/new?propertyId=${p.id}` },
                can(user, "payments.manage") && { label: "تسجيل سند قبض", href: `/payments/new?propertyId=${p.id}` },
                can(user, "expenses.manage") && { label: "تسجيل مصروف", href: `/expenses/new?propertyId=${p.id}` },
                can(user, "documents.manage") && { label: "إضافة مستند", href: `/documents/new?entityType=PROPERTY&entityId=${p.id}&entityLabel=${encodeURIComponent(p.name)}` },
                can(user, "properties.manage") &&
                  (p.status === "ARCHIVED"
                    ? { label: "استعادة", node: <ActionButton action={restoreProperty} hidden={{ id: p.id }} className="btn btn-ghost btn-sm">استعادة العقار</ActionButton> }
                    : { label: "أرشفة", danger: true, node: <ActionButton action={archiveProperty} hidden={{ id: p.id }} className="btn btn-ghost btn-sm text-danger" confirm="أرشفة العقار وكل وحداته؟ يمكن استعادته لاحقًا.">أرشفة العقار</ActionButton> }),
              ]}
            />
          </>
        }
      />

      <StatGrid cols={4}>
        <StatCard label="الوحدات" value={`${num(rented)} / ${num(activeUnits.length)}`} sub={`${num(activeUnits.filter((u) => ["VACANT", "AVAILABLE"].includes(u.status)).length)} شاغرة`} />
        <StatCard label="الإشغال" value={pct(occupancy)} sub={<Progress value={occupancy} />} />
        <StatCard label="الإيجار السنوي" value={money(annualRent)} />
        <StatCard label="المتأخرات" value={money(overdueAmt)} tone={overdueAmt > 0 ? "danger" : undefined} href={`/properties/${p.id}?tab=collections`} />
      </StatGrid>

      <div className="mt-4">
        <Tabs tabs={TABS} active={tab} base={`/properties/${p.id}`} sticky />
      </div>

      {tab === "overview" && (
        <div className="space-y-4">
          <div className="grid gap-4 xl:grid-cols-3">
            <Suspense fallback={<AssistantCardSkeleton />}>
              <div className="xl:col-span-2">
                <PropertyBrief user={user} property={{ id: p.id, name: p.name, type: PROPERTY_TYPES[p.type] ?? p.type }} />
              </div>
            </Suspense>
            <Card title="الملكية" subtitle={currentOwners.length > 1 ? "ملكية مشتركة" : undefined}>
              {currentOwners.map((o) => (
                <div key={o.id} className="flex items-center justify-between border-b border-line-soft py-2 last:border-0">
                  <div>
                    <Link href={`/owners/${o.owner.id}`} className="font-bold hover:text-brand">
                      {o.owner.name}
                    </Link>
                    <div className="text-xs text-muted">
                      أتعاب الإدارة <span className="num">{o.owner.managementFeePct}%</span> · منذ {date(o.startDate)}
                    </div>
                  </div>
                  <b className="num text-lg text-brand">{o.percentage}%</b>
                </div>
              ))}
              {historicalOwners.length > 0 && (
                <details className="mt-2 text-[12.5px] text-muted">
                  <summary className="font-bold">الملكية السابقة ({historicalOwners.length})</summary>
                  {historicalOwners.map((o) => (
                    <div key={o.id} className="mt-1">
                      {o.owner.name} — <span className="num">{o.percentage}%</span> · {date(o.startDate)} → {date(o.endDate)}
                    </div>
                  ))}
                </details>
              )}
              {can(user, "statements.manage") && currentOwners[0] && (
                <Link href={`/statements/new?ownerId=${currentOwners[0].owner.id}&propertyId=${p.id}`} className="btn btn-outline btn-sm mt-3 w-full">
                  كشف حساب المالك
                </Link>
              )}
            </Card>
          </div>

          <div className="grid gap-4 xl:grid-cols-3">
            <Card title="هذه السنة" subtitle="منذ بداية السنة الميلادية">
              <KV k="الإيجار المحصل" v={<span className="num">{money(ytdIncome)}</span>} />
              <KV k="أتعاب الإدارة" v={<span className="num">{money(ytdFees)}</span>} />
              <KV k="المصروفات المعتمدة" v={<span className="num">{money(ytdExp)}</span>} />
              <KV k="صافي للمالك" v={<b className="num text-brand">{money(ytdIncome - ytdFees - ytdExp)}</b>} />
              <KV k="دفعات متأخرة الآن" v={<Link href={`/properties/${p.id}?tab=collections`} className={`num link ${overdueInst._count > 0 ? "text-danger" : ""}`}>{overdueInst._count}</Link>} />
            </Card>

            <Card title="يحتاج انتباهك" padded={false} actions={<Link href={`/properties/${p.id}?tab=collections`} className="link text-xs">التحصيل</Link>}>
              {attention.length === 0 ? (
                <EmptyState title="لا يوجد ما يحتاج تدخلًا" description="الدفعات مسددة والعقود سارية." />
              ) : (
                <ul className="divide-y divide-line">
                  {attention.slice(0, 8).map((a, i) => (
                    <li key={i}>
                      <Link href={a.href} className="flex items-start justify-between gap-3 px-5 py-2.5 text-[13px] hover:bg-mist">
                        <div className="min-w-0">
                          <div className="truncate font-bold">{a.label}</div>
                          <div className="truncate text-[12px] text-muted">{a.sub}</div>
                        </div>
                        <Tag tone={a.tone} plain>
                          {a.tone === "danger" ? "تحصيل" : a.tone === "warning" ? "تجديد" : "اعتماد"}
                        </Tag>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card title="المهام المفتوحة" padded={false} actions={can(user, "tasks.manage") ? <Link href={`/tasks/new?entityType=PROPERTY&entityId=${p.id}&entityLabel=${encodeURIComponent(p.name)}`} className="link text-xs">مهمة جديدة</Link> : undefined}>
              {openTasks.length === 0 ? (
                <EmptyState title="لا توجد مهام مفتوحة" />
              ) : (
                <ul className="divide-y divide-line">
                  {openTasks.map((t) => (
                    <li key={t.id} className="flex items-center justify-between gap-2 px-5 py-2.5 text-[13px]">
                      <div className="min-w-0">
                        <Link href={`/tasks/${t.id}`} className="block truncate font-semibold hover:text-brand">
                          {t.title}
                        </Link>
                        <div className="text-[12px] text-muted">{t.assignedTo?.name ?? "غير مسندة"}</div>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <StatusTag value={t.priority} map={TASK_PRIORITY} />
                        {t.dueDate && <span className={`text-[11.5px] ${t.dueDate < now ? "text-danger" : "text-muted"}`}>{date(t.dueDate)}</span>}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <Optional title="بيانات العقار" hint={[p.city, p.district].filter(Boolean).join(" — ") || undefined}>
            <DL
              cols={3}
              items={[
                { label: "الفرع", value: p.branch?.name },
                { label: "مدير العقار", value: p.manager ? <Link className="link" href={`/employees/${p.manager.id}`}>{p.manager.name}</Link> : null },
                { label: "الشارع", value: p.street },
                { label: "العنوان الوطني", value: p.nationalAddress },
                { label: "رقم الصك", value: p.deedNumber ? <span className="latin">{p.deedNumber}</span> : null },
                { label: "مساحة الأرض", value: p.landArea ? `${num(p.landArea)} م²` : null },
                { label: "مساحة البناء", value: p.buildingArea ? `${num(p.buildingArea)} م²` : null },
                { label: "عدد الأدوار", value: p.floors },
                { label: "سنة البناء", value: p.buildYear },
                { label: "الموقع", value: p.lat && p.lng ? <a className="link latin" target="_blank" href={`https://maps.google.com/?q=${p.lat},${p.lng}`}>{p.lat.toFixed(4)}, {p.lng.toFixed(4)}</a> : null },
                ...Object.entries(cf).map(([k, v]) => ({ label: k, value: v })),
              ]}
            />
            {p.notes && <p className="mt-4 rounded-xl bg-mist px-4 py-3 text-[13px] text-text-2">{p.notes}</p>}
          </Optional>
        </div>
      )}

      {tab === "units" && (
        <Card padded={false} title={`الوحدات (${activeUnits.length})`} actions={can(user, "units.manage") ? <Link href={`/units/new?propertyId=${p.id}`} className="btn btn-primary btn-sm">إضافة وحدة</Link> : undefined}>
          {p.units.length === 0 ? (
            <EmptyState title="لا توجد وحدات" description="أضف وحدات هذا العقار واحدة أو كنطاق أرقام لبدء التأجير." action={can(user, "units.manage") ? <Link href={`/units/new?propertyId=${p.id}`} className="btn btn-outline btn-sm">إضافة وحدة</Link> : undefined} />
          ) : (
            <Table>
              <thead>
                <tr>
                  <th>الوحدة</th>
                  <th>الدور</th>
                  <th>النوع</th>
                  <th className="num">المساحة</th>
                  <th className="num">الإيجار المستهدف</th>
                  <th className="num">الإيجار الحالي</th>
                  <th>المستأجر الحالي</th>
                  <th>الحالة</th>
                </tr>
              </thead>
              <tbody>
                {p.units.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <Link href={`/units/${u.id}`} className="cell-primary latin hover:text-brand">
                        {u.number}
                      </Link>
                    </td>
                    <td className="num">{u.floor ?? "—"}</td>
                    <td>{UNIT_TYPES[u.type] ?? u.type}</td>
                    <td className="num">{u.area ? `${num(u.area)} م²` : "—"}</td>
                    <td className="num">{money(u.targetRent)}</td>
                    <td className="num font-semibold">{money(u.currentRent)}</td>
                    <td>{u.contracts[0] ? <Link className="link" href={`/tenants/${u.contracts[0].tenant.id}`}>{u.contracts[0].tenant.name}</Link> : <span className="text-faint">—</span>}</td>
                    <td>
                      <StatusTag value={u.status} map={UNIT_STATUS} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      )}

      {tab === "contracts" && <ContractsTab propertyId={p.id} canManage={can(user, "contracts.manage")} />}
      {tab === "collections" && <CollectionsTab user={user} propertyId={p.id} filter={f} unitId={unitId} />}
      {tab === "expenses" && <ExpensesTab propertyId={p.id} canManage={can(user, "expenses.manage")} />}
      {tab === "documents" && <DocumentsTab propertyId={p.id} propertyName={p.name} canManage={can(user, "documents.manage")} />}
      {tab === "financials" && <FinancialsTab propertyId={p.id} />}
      {tab === "activity" && <ActivityTab propertyId={p.id} />}
    </>
  );
}

/* ───────── Tabs ───────── */

async function ContractsTab({ propertyId, canManage }: { propertyId: string; canManage: boolean }) {
  const rows = await db.contract.findMany({ where: { propertyId }, orderBy: { endDate: "desc" }, include: { tenant: { select: { id: true, name: true } }, unit: { select: { number: true } } } });
  const newHref = `/contracts/new?propertyId=${propertyId}`;
  return (
    <Card padded={false} title={`العقود (${rows.length})`} actions={canManage ? <Link href={newHref} className="btn btn-primary btn-sm">عقد جديد</Link> : undefined}>
      {rows.length === 0 ? (
        <EmptyState title="لا توجد عقود" description="أنشئ أول عقد على وحدة من وحدات هذا العقار، وتُولَّد الدفعات عند تفعيله." action={canManage ? <Link href={newHref} className="btn btn-outline btn-sm">عقد جديد</Link> : undefined} />
      ) : (
        <Table>
          <thead>
            <tr>
              <th>العقد</th>
              <th>الوحدة</th>
              <th>المستأجر</th>
              <th>البداية</th>
              <th>النهاية</th>
              <th className="num">القيمة</th>
              <th>الحالة</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id}>
                <td>
                  <Link href={`/contracts/${c.id}`} className="cell-primary latin hover:text-brand">
                    {c.code}
                  </Link>
                </td>
                <td className="latin">{c.unit.number}</td>
                <td>
                  <Link href={`/tenants/${c.tenant.id}`} className="hover:text-brand">
                    {c.tenant.name}
                  </Link>
                </td>
                <td>{date(c.startDate)}</td>
                <td>
                  {date(c.endDate)}
                  {["ACTIVE", "EXPIRING_SOON", "RENEWAL_PENDING"].includes(c.status) && <div className="cell-sub">بعد {daysFromToday(c.endDate)} يوم</div>}
                </td>
                <td className="num font-semibold">{money(c.totalAmount)}</td>
                <td>
                  <StatusTag value={c.status} map={CONTRACT_STATUS} />
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

async function ExpensesTab({ propertyId, canManage }: { propertyId: string; canManage: boolean }) {
  const rows = await db.expense.findMany({ where: { propertyId }, orderBy: { date: "desc" }, take: 50, include: { unit: { select: { number: true } } } });
  const total = rows.filter((e) => e.approvalStatus === "APPROVED").reduce((s, e) => s + e.amount + e.vatAmount, 0);
  const newHref = `/expenses/new?propertyId=${propertyId}`;
  return (
    <Card padded={false} title="المصروفات" subtitle={`المعتمد: ${money(total)} ر.س`} actions={canManage ? <Link href={newHref} className="btn btn-primary btn-sm">تسجيل مصروف</Link> : undefined}>
      {rows.length === 0 ? (
        <EmptyState title="لا توجد مصروفات" description="سجّل الصيانة والخدمات على هذا العقار لتُخصم من كشف حساب المالك." action={canManage ? <Link href={newHref} className="btn btn-outline btn-sm">تسجيل مصروف</Link> : undefined} />
      ) : (
        <Table>
          <thead>
            <tr>
              <th>الرقم</th>
              <th>التاريخ</th>
              <th>الوصف</th>
              <th>الفئة</th>
              <th>الجهة</th>
              <th className="num">المبلغ</th>
              <th>الاعتماد</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.id}>
                <td className="latin text-muted">
                  <Link href={`/expenses/${e.id}`} className="hover:text-brand">
                    {e.code}
                  </Link>
                </td>
                <td>{date(e.date)}</td>
                <td>
                  {e.description}
                  {e.unit && <div className="cell-sub latin">{e.unit.number}</div>}
                </td>
                <td>{EXPENSE_CATEGORIES[e.category]}</td>
                <td className="text-muted">{e.payee ?? "—"}</td>
                <td className="num font-semibold">{money(e.amount + e.vatAmount)}</td>
                <td>
                  <StatusTag value={e.approvalStatus} map={APPROVAL_STATUS} />
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

async function DocumentsTab({ propertyId, propertyName, canManage }: { propertyId: string; propertyName: string; canManage: boolean }) {
  const rows = await db.document.findMany({ where: { entityType: "PROPERTY", entityId: propertyId }, orderBy: { createdAt: "desc" } });
  const newHref = `/documents/new?entityType=PROPERTY&entityId=${propertyId}&entityLabel=${encodeURIComponent(propertyName)}`;
  return (
    <Card padded={false} title="المستندات" actions={canManage ? <Link href={newHref} className="btn btn-primary btn-sm">إضافة مستند</Link> : undefined}>
      {rows.length === 0 ? (
        <EmptyState title="لا توجد مستندات" description="ارفع الصك، الرخص، والوثائق المرتبطة بالعقار." action={canManage ? <Link href={newHref} className="btn btn-outline btn-sm">رفع مستند</Link> : undefined} />
      ) : (
        <Table>
          <thead>
            <tr>
              <th>المستند</th>
              <th>النوع</th>
              <th>الإصدار</th>
              <th>الانتهاء</th>
              <th>الإصدار</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => {
              const left = d.expiryDate ? daysFromToday(d.expiryDate) : null;
              return (
                <tr key={d.id}>
                  <td>
                    <Link href={`/documents/${d.id}`} className="cell-primary hover:text-brand">
                      {d.name}
                    </Link>
                  </td>
                  <td>{DOCUMENT_TYPES[d.type]}</td>
                  <td>{date(d.issueDate)}</td>
                  <td>
                    {d.expiryDate ? (
                      <span className={left !== null && left < 0 ? "text-danger" : left !== null && left <= 30 ? "text-warning" : ""}>
                        {date(d.expiryDate)}
                        {left !== null && <span className="cell-sub"> ({left < 0 ? `منتهي منذ ${-left} يوم` : `بعد ${left} يوم`})</span>}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="num">v{d.version}</td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

async function FinancialsTab({ propertyId }: { propertyId: string }) {
  const now = new Date();
  const months = Array.from({ length: 12 }, (_, i) => ksaDate(ksaParts(now).y, ksaParts(now).m - 11 + i, 1));
  const rows = await Promise.all(
    months.map(async (m) => {
      const s = startOfMonth(m);
      const e = endOfMonth(m);
      const [inc, exp, due] = await Promise.all([
        db.paymentAllocation.aggregate({ where: { installment: { contract: { propertyId } }, payment: { paidAt: { gte: s, lte: e }, status: { in: ["RECORDED", "APPROVED"] } } }, _sum: { amount: true } }),
        db.expense.aggregate({ where: { propertyId, approvalStatus: "APPROVED", date: { gte: s, lte: e } }, _sum: { amount: true, vatAmount: true } }),
        db.installment.aggregate({ where: { contract: { propertyId }, dueDate: { gte: s, lte: e }, status: { not: "WAIVED" } }, _sum: { amount: true } }),
      ]);
      return { m, income: inc._sum.amount ?? 0, expense: (exp._sum.amount ?? 0) + (exp._sum.vatAmount ?? 0), due: due._sum.amount ?? 0 };
    }),
  );
  const tot = rows.reduce((a, r) => ({ income: a.income + r.income, expense: a.expense + r.expense, due: a.due + r.due }), { income: 0, expense: 0, due: 0 });
  const max = Math.max(1, ...rows.map((r) => Math.max(r.income, r.expense)));
  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <Card title="الأداء المالي — آخر 12 شهرًا" className="xl:col-span-2">
        <div className="flex h-44 items-end gap-1.5">
          {rows.map((r) => (
            <div key={r.m.toISOString()} className="flex flex-1 flex-col items-center gap-1">
              <div className="flex w-full items-end justify-center gap-0.5" style={{ height: 150 }}>
                <div className="w-1/2 rounded-t bg-brand-500" style={{ height: `${(r.income / max) * 100}%` }} title={`إيراد ${money(r.income)}`} />
                <div className="w-1/2 rounded-t bg-sand" style={{ height: `${(r.expense / max) * 100}%` }} title={`مصروف ${money(r.expense)}`} />
              </div>
              <span className="text-[10px] text-muted">{new Intl.DateTimeFormat("ar-SA-u-nu-latn-ca-gregory", { month: "short" }).format(r.m)}</span>
            </div>
          ))}
        </div>
        <div className="mt-2 flex gap-4 text-[12px] text-muted">
          <span className="flex items-center gap-1"><i className="inline-block h-2.5 w-2.5 rounded-sm bg-brand-500" /> الإيراد المحصل</span>
          <span className="flex items-center gap-1"><i className="inline-block h-2.5 w-2.5 rounded-sm bg-sand" /> المصروفات المعتمدة</span>
        </div>
      </Card>
      <Card title="ملخص 12 شهرًا" tone="dark">
        <KV k="المستحق" v={<span className="num">{money(tot.due)}</span>} />
        <KV k="الإيراد المحصل" v={<span className="num">{money(tot.income)}</span>} />
        <KV k="المصروفات" v={<span className="num">{money(tot.expense)}</span>} />
        <KV k="صافي دخل التشغيل (NOI)" v={<b className="num text-xl text-sand-200">{money(tot.income - tot.expense)}</b>} />
        <KV k="نسبة التحصيل" v={<span className="num">{pct(tot.due ? (tot.income / tot.due) * 100 : 0)}</span>} />
      </Card>
    </div>
  );
}

async function ActivityTab({ propertyId }: { propertyId: string }) {
  const rows = await db.auditLog.findMany({ where: { OR: [{ entityType: "PROPERTY", entityId: propertyId }, { entityType: "UNIT", entityId: { in: (await db.unit.findMany({ where: { propertyId }, select: { id: true } })).map((u) => u.id) } }] }, orderBy: { createdAt: "desc" }, take: 50 });
  return (
    <Card title="سجل العمليات">
      {rows.length === 0 ? (
        <EmptyState title="لا توجد عمليات مسجلة" />
      ) : (
        <div className="timeline">
          {rows.map((a) => (
            <div key={a.id} className="timeline-item">
              <div className="text-[13px]">
                <StatusTag value={a.action} map={AUDIT_ACTIONS} /> <b>{a.userName}</b> {a.entityLabel && <span className="text-muted">— {a.entityLabel}</span>}
              </div>
              <div className="text-[11.5px] text-faint">{datetime(a.createdAt)}</div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
