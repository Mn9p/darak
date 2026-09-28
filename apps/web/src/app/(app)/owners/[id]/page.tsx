import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { can, isScoped } from "@/lib/permissions";
import { computeOwnerStatement } from "@/lib/engine";
import { displayPhone, isValidPhone, telHref } from "@/lib/phone";
import { PARTY_TYPES, OWNER_STATUS, PROPERTY_TYPES, PROPERTY_STATUS, CONTRACT_STATUS, INSTALLMENT_STATUS, COLLECTION_STATUS, EXPENSE_CATEGORIES, APPROVAL_STATUS, STATEMENT_STATUS, DOCUMENT_TYPES, AUDIT_ACTIONS } from "@/lib/constants";
import { money, num, pct, date, datetime, daysFromToday, daysOverdue, tagsToArray, startOfYear, ksaParts } from "@/lib/format";
import { PageHeader, Card, Table, StatusTag, Tabs, DL, StatGrid, StatCard, EmptyState, Tag, ActionButton, KV, Progress } from "@/components/ui";
import { MoreMenu } from "@/components/MoreMenu";
import { archiveOwner, restoreOwner } from "../actions";

export const dynamic = "force-dynamic";

const ACTIVE_CONTRACT = ["ACTIVE", "EXPIRING_SOON", "RENEWAL_PENDING"];

export default async function OwnerPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const user = await requireStaff();
  const { id } = await params;
  const { tab = "overview" } = await searchParams;
  const org = user.organizationId;
  const financial = can(user, "owners.financial");
  const scope = isScoped(user) ? { ownerships: { some: { propertyId: { in: user.assignedPropertyIds } } } } : {};

  const o = await db.owner.findFirst({
    where: { id, organizationId: org, ...scope },
    include: {
      accountManager: { select: { id: true, name: true } },
      portalUser: { select: { id: true, phone: true, lastLoginAt: true } },
      ownerships: {
        orderBy: [{ endDate: "asc" }, { startDate: "desc" }],
        include: { property: { select: { id: true, name: true, code: true, type: true, city: true, status: true, units: { select: { status: true, currentRent: true } } } } },
      },
    },
  });
  if (!o) notFound();

  const current = o.ownerships.filter((x) => !x.endDate);
  const historical = o.ownerships.filter((x) => x.endDate);
  const currentPropertyIds = [...new Set(current.map((x) => x.propertyId))];
  const activeProps = current.filter((x) => x.property.status !== "ARCHIVED");
  const unitsTotal = activeProps.reduce((s, x) => s + x.property.units.filter((u) => u.status !== "ARCHIVED").length, 0);
  const unitsRented = activeProps.reduce((s, x) => s + x.property.units.filter((u) => u.status === "RENTED").length, 0);
  const annualRentShare = activeProps.reduce((s, x) => s + (x.property.units.reduce((a, u) => a + (u.currentRent ?? 0), 0) * x.percentage) / 100, 0);
  const occupancy = unitsTotal ? (unitsRented / unitsTotal) * 100 : 0;

  const now = new Date();
  const yearStart = startOfYear(now);
  const [ytd, overdueInst, activeContracts, statementsCount, docsCount] = await Promise.all([
    financial ? computeOwnerStatement(org, id, yearStart, now) : Promise.resolve(null),
    currentPropertyIds.length
      ? db.installment.aggregate({ where: { organizationId: org, contract: { propertyId: { in: currentPropertyIds } }, status: { in: ["OVERDUE", "PARTIALLY_PAID"] } }, _sum: { amount: true, paidAmount: true }, _count: true })
      : Promise.resolve({ _sum: { amount: 0, paidAmount: 0 }, _count: 0 }),
    db.contract.count({ where: { organizationId: org, status: { in: ACTIVE_CONTRACT }, OR: [{ ownerId: id }, ...(currentPropertyIds.length ? [{ propertyId: { in: currentPropertyIds } }] : [])] } }),
    db.ownerStatement.count({ where: { organizationId: org, ownerId: id } }),
    db.document.count({ where: { organizationId: org, entityType: "OWNER", entityId: id } }),
  ]);
  const overdueAmt = (overdueInst._sum.amount ?? 0) - (overdueInst._sum.paidAmount ?? 0);
  const ibanMasked = o.iban ? `SA•• •••• •••• •••• •••• ${o.iban.slice(-4)}` : null;

  const TABS = [
    { key: "overview", label: "نظرة عامة" },
    { key: "properties", label: "العقارات", count: currentPropertyIds.length },
    { key: "contracts", label: "العقود" },
    { key: "collections", label: "التحصيل" },
    { key: "expenses", label: "المصروفات" },
    ...(financial ? [{ key: "statements", label: "كشوف الحساب", count: statementsCount }] : []),
    { key: "documents", label: "المستندات", count: docsCount },
    { key: "activity", label: "سجل العمليات" },
  ];
  const activeTab = TABS.some((t) => t.key === tab) ? tab : "overview";

  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {o.name} <StatusTag value={o.status} map={OWNER_STATUS} />
            <Tag tone="neutral" plain>
              {PARTY_TYPES[o.type] ?? o.type}
            </Tag>
            {o.type === "COMPANY" && !o.crNumber && (
              <Tag tone="neutral" plain>
                السجل التجاري غير مسجل
              </Tag>
            )}
            {tagsToArray(o.tags).map((t) => (
              <Tag key={t} tone="brand" plain>
                {t}
              </Tag>
            ))}
          </span>
        }
        subtitle={
          <span>
            <span className="latin">{o.code}</span> · أتعاب الإدارة <span className="num">{pct(o.managementFeePct, 1)}</span>
            {o.accountManager && <> · مدير الحساب: {o.accountManager.name}</>}
            {o.portalUser ? <> · حساب البوابة مفعّل</> : isValidPhone(o.phone) ? <> · البوابة جاهزة برقم الجوال</> : null}
          </span>
        }
        breadcrumbs={[{ label: "الملاك", href: "/owners" }, { label: o.name }]}
        actions={
          <>
            {financial && can(user, "statements.manage") && (
              <Link href={`/statements/new?ownerId=${o.id}`} className="btn btn-outline btn-sm">
                كشف حساب جديد
              </Link>
            )}
            {can(user, "owners.manage") && o.status !== "ARCHIVED" && (
              <Link href={`/owners/${o.id}/edit`} className="btn btn-primary btn-sm">
                تعديل
              </Link>
            )}
            <MoreMenu
              items={[
                can(user, "properties.manage") && { label: "إضافة عقار", href: `/properties/new?ownerId=${o.id}` },
                can(user, "tasks.manage") && { label: "مهمة جديدة", href: `/tasks/new?entityType=OWNER&entityId=${o.id}&entityLabel=${encodeURIComponent(o.name)}` },
                can(user, "owners.manage") &&
                  (o.status === "ARCHIVED"
                    ? { label: "استعادة", node: <ActionButton action={restoreOwner} hidden={{ id: o.id }} className="btn btn-ghost btn-sm">استعادة المالك</ActionButton> }
                    : { label: "أرشفة", danger: true, node: <ActionButton action={archiveOwner} hidden={{ id: o.id }} className="btn btn-ghost btn-sm text-danger" confirm="أرشفة المالك؟ يبقى سجله وكشوفه محفوظة ويمكن استعادته لاحقًا.">أرشفة المالك</ActionButton> }),
              ]}
            />
          </>
        }
      />

      <StatGrid cols={4}>
        <StatCard label="العقارات" value={num(currentPropertyIds.length)} href={`/owners/${o.id}?tab=properties`} />
        <StatCard label="الوحدات (مؤجرة/الكل)" value={<span className="num">{unitsRented}/{unitsTotal}</span>} sub={<Progress value={occupancy} />} />
        <StatCard label="الإيجار السنوي (حصته)" value={money(annualRentShare)} />
        <StatCard label="المتأخرات على عقاراته" value={money(overdueAmt)} tone={overdueAmt > 0 ? "danger" : undefined} href={`/owners/${o.id}?tab=collections`} sub={`${overdueInst._count} قسط`} />
      </StatGrid>

      <div className="mt-4">
        <Tabs tabs={TABS} active={activeTab} base={`/owners/${o.id}`} />
      </div>

      {activeTab === "overview" && (
        <div className="grid gap-4 xl:grid-cols-3">
          <div className="space-y-4 xl:col-span-2">
            <Card title="الملكيات">
              {current.length === 0 ? (
                <EmptyState title="لا توجد ملكيات حالية" description="أضف عقارًا لهذا المالك ويُربط به بنسبة 100%، أو اربطه بعقار قائم من صفحة العقار." action={can(user, "properties.manage") ? <Link href={`/properties/new?ownerId=${o.id}`} className="btn btn-primary btn-sm">إضافة عقار</Link> : undefined} />
              ) : (
                <div className="space-y-1">
                  {current.map((x) => (
                    <div key={x.id} className="flex items-center justify-between gap-3 border-b border-[#EDF1EF] py-2 last:border-0">
                      <div className="min-w-0">
                        <Link href={`/properties/${x.property.id}`} className="font-bold hover:text-brand">
                          {x.property.name}
                        </Link>
                        <div className="text-xs text-muted">
                          {PROPERTY_TYPES[x.property.type] ?? x.property.type} · {x.property.city ?? "—"} · منذ {date(x.startDate)}
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <StatusTag value={x.property.status} map={PROPERTY_STATUS} />
                        <b className="num text-lg text-brand">{x.percentage}%</b>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {historical.length > 0 && (
                <details className="mt-3 text-[12.5px] text-muted">
                  <summary className="cursor-pointer font-bold">الملكيات السابقة ({historical.length})</summary>
                  <div className="mt-2 space-y-1">
                    {historical.map((x) => (
                      <div key={x.id}>
                        <Link href={`/properties/${x.property.id}`} className="hover:text-brand">
                          {x.property.name}
                        </Link>{" "}
                        — <span className="num">{x.percentage}%</span> · {date(x.startDate)} → {date(x.endDate)}
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </Card>

            <Card title="بيانات المالك">
              <DL
                cols={3}
                items={[
                  ...(o.type === "COMPANY"
                    ? [
                        { label: "السجل التجاري", value: o.crNumber ? <span className="latin">{o.crNumber}</span> : null },
                        { label: "الرقم الضريبي", value: o.vatNumber ? <span className="latin">{o.vatNumber}</span> : null },
                        { label: "الممثل / المفوض", value: o.representative },
                      ]
                    : [
                        { label: "رقم الهوية", value: o.nationalId ? <span className="latin">{o.nationalId}</span> : null },
                        { label: "الجنسية", value: o.nationality },
                      ]),
                  { label: "الجوال", value: o.phone ? <a className="link num" href={telHref(o.phone)}>{displayPhone(o.phone)}</a> : null },
                  { label: "البريد الإلكتروني", value: o.email ? <a className="link latin" href={`mailto:${o.email}`}>{o.email}</a> : null },
                  { label: "العنوان", value: o.address },
                  { label: "بداية الإدارة", value: o.managementStartDate ? date(o.managementStartDate) : null },
                  { label: "عميل منذ", value: date(o.createdAt) },
                  {
                    label: "حساب البوابة",
                    value: o.portalUser ? (
                      <span>
                        مفعّل · آخر دخول <span className="num">{o.portalUser.lastLoginAt ? datetime(o.portalUser.lastLoginAt) : "—"}</span>
                      </span>
                    ) : isValidPhone(o.phone) ? (
                      <span>
                        يدخل برقم <span className="num">{displayPhone(o.phone)}</span> عند أول تسجيل دخول
                      </span>
                    ) : (
                      "أضف رقم جوال لتفعيل البوابة"
                    ),
                  },
                  ...(financial
                    ? [
                        { label: "الآيبان", value: ibanMasked ? <span className="latin">{ibanMasked}</span> : null },
                        { label: "البنك", value: o.bankName },
                      ]
                    : []),
                ]}
              />
              {o.agreementTerms && (
                <div className="mt-4">
                  <div className="mb-1 text-[12.5px] font-bold text-muted">شروط اتفاقية الإدارة</div>
                  <p className="rounded-xl bg-mist px-4 py-3 text-[13px] text-text-2 whitespace-pre-line">{o.agreementTerms}</p>
                </div>
              )}
              {o.notes && <p className="mt-4 rounded-xl bg-sand-75 px-4 py-3 text-[13px] text-text-2">{o.notes}</p>}
            </Card>
          </div>

          <div className="space-y-4">
            {financial && ytd ? (
              <Card title={`الملخص المالي — ${ksaParts(now).y}`} subtitle="محسوب وفق نسب الملكية" tone="dark">
                <KV k="حصته من الإيجار المحصل" v={<span className="num">{money(ytd.collectedRent)}</span>} />
                <KV k="أتعاب الإدارة" v={<span className="num">− {money(ytd.managementFees)}</span>} />
                <KV k="المصروفات المعتمدة" v={<span className="num">− {money(ytd.expenses)}</span>} />
                <KV k="صافي المستحق" v={<b className="num text-xl text-sand-200">{money(ytd.netDue)}</b>} />
                <Link href={`/owners/${o.id}?tab=statements`} className="btn btn-accent btn-sm mt-4 w-full">
                  كشوف الحساب
                </Link>
              </Card>
            ) : (
              <Card title="الملخص المالي">
                <p className="text-[13px] text-muted">تتطلب البيانات المالية للمالك صلاحية مالية.</p>
              </Card>
            )}
            <Card title="مؤشرات سريعة">
              <KV k="عقود نشطة" v={<Link href={`/owners/${o.id}?tab=contracts`} className="num link">{activeContracts}</Link>} />
              <KV k="نسبة الإشغال" v={<span className="num">{pct(occupancy)}</span>} />
              <KV k="أقساط متأخرة" v={<span className={`num ${overdueInst._count > 0 ? "text-danger" : ""}`}>{overdueInst._count}</span>} />
              <KV k="المستندات" v={<span className="num">{docsCount}</span>} />
            </Card>
          </div>
        </div>
      )}

      {activeTab === "properties" && <PropertiesTab rows={activeProps} archived={current.filter((x) => x.property.status === "ARCHIVED")} ownerId={o.id} />}
      {activeTab === "contracts" && <ContractsTab ownerId={o.id} propertyIds={currentPropertyIds} org={org} />}
      {activeTab === "collections" && <CollectionsTab propertyIds={currentPropertyIds} org={org} />}
      {activeTab === "expenses" && <ExpensesTab ownerId={o.id} propertyIds={currentPropertyIds} org={org} />}
      {activeTab === "statements" && financial && <StatementsTab ownerId={o.id} org={org} canManage={can(user, "statements.manage")} />}
      {activeTab === "documents" && <DocumentsTab ownerId={o.id} name={o.name} canManage={can(user, "documents.manage")} />}
      {activeTab === "activity" && <ActivityTab ownerId={o.id} />}
    </>
  );
}

/* ───────── Tabs ───────── */

type OwnershipRow = { id: string; percentage: number; startDate: Date; property: { id: string; name: string; code: string; type: string; city: string | null; status: string; units: { status: string; currentRent: number | null }[] } };

function PropertiesTab({ rows, archived, ownerId }: { rows: OwnershipRow[]; archived: OwnershipRow[]; ownerId: string }) {
  return (
    <Card padded={false} title={`العقارات المملوكة (${rows.length})`} subtitle={archived.length ? `${archived.length} عقار مؤرشف` : undefined}>
      {rows.length === 0 ? (
        <EmptyState title="لا توجد عقارات" description="أضف عقارًا لهذا المالك أو اربطه بعقار قائم من صفحة العقار." action={<Link href={`/properties/new?ownerId=${ownerId}`} className="btn btn-outline btn-sm">إضافة عقار</Link>} />
      ) : (
        <Table>
          <thead>
            <tr>
              <th>العقار</th>
              <th>النوع</th>
              <th>المدينة</th>
              <th className="num">نسبة الملكية</th>
              <th className="num">الوحدات</th>
              <th>الإشغال</th>
              <th className="num">الإيجار السنوي</th>
              <th className="num">حصة المالك</th>
              <th>الحالة</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((x) => {
              const units = x.property.units.filter((u) => u.status !== "ARCHIVED");
              const rented = units.filter((u) => u.status === "RENTED").length;
              const occ = units.length ? (rented / units.length) * 100 : 0;
              const rent = units.reduce((s, u) => s + (u.currentRent ?? 0), 0);
              return (
                <tr key={x.id}>
                  <td>
                    <Link href={`/properties/${x.property.id}`} className="cell-primary hover:text-brand">
                      {x.property.name}
                    </Link>
                    <div className="cell-sub latin">{x.property.code}</div>
                  </td>
                  <td>{PROPERTY_TYPES[x.property.type] ?? x.property.type}</td>
                  <td>{x.property.city ?? "—"}</td>
                  <td className="num font-bold text-brand">{x.percentage}%</td>
                  <td className="num">
                    {rented}/{units.length}
                  </td>
                  <td>
                    <div className="flex items-center gap-2">
                      <div className="w-16">
                        <Progress value={occ} tone={occ < 60 ? "danger" : occ < 85 ? "warn" : undefined} />
                      </div>
                      <span className="num text-xs text-muted">{Math.round(occ)}%</span>
                    </div>
                  </td>
                  <td className="num">{money(rent)}</td>
                  <td className="num font-semibold">{money((rent * x.percentage) / 100)}</td>
                  <td>
                    <StatusTag value={x.property.status} map={PROPERTY_STATUS} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

async function ContractsTab({ ownerId, propertyIds, org }: { ownerId: string; propertyIds: string[]; org: string }) {
  const rows = await db.contract.findMany({
    where: { organizationId: org, OR: [{ ownerId }, ...(propertyIds.length ? [{ propertyId: { in: propertyIds } }] : [])] },
    orderBy: { endDate: "desc" },
    take: 100,
    include: { tenant: { select: { id: true, name: true } }, unit: { select: { id: true, number: true } }, property: { select: { id: true, name: true } } },
  });
  const active = rows.filter((c) => ACTIVE_CONTRACT.includes(c.status)).length;
  return (
    <Card padded={false} title={`العقود (${rows.length})`} subtitle={`نشطة: ${active}`}>
      {rows.length === 0 ? (
        <EmptyState title="لا توجد عقود على عقارات هذا المالك" />
      ) : (
        <Table>
          <thead>
            <tr>
              <th>العقد</th>
              <th>العقار / الوحدة</th>
              <th>المستأجر</th>
              <th>البداية</th>
              <th>النهاية</th>
              <th className="num">القيمة</th>
              <th className="num">أتعاب %</th>
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
                <td>
                  <Link href={`/properties/${c.property.id}`} className="hover:text-brand">
                    {c.property.name}
                  </Link>
                  <div className="cell-sub latin">
                    <Link href={`/units/${c.unit.id}`} className="hover:text-brand">
                      {c.unit.number}
                    </Link>
                  </div>
                </td>
                <td>
                  <Link href={`/tenants/${c.tenant.id}`} className="hover:text-brand">
                    {c.tenant.name}
                  </Link>
                </td>
                <td>{date(c.startDate)}</td>
                <td>
                  {date(c.endDate)}
                  {ACTIVE_CONTRACT.includes(c.status) && <div className="cell-sub">بعد {daysFromToday(c.endDate)} يوم</div>}
                </td>
                <td className="num font-semibold">{money(c.totalAmount)}</td>
                <td className="num">{pct(c.managementFeePct, 1)}</td>
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

async function CollectionsTab({ propertyIds, org }: { propertyIds: string[]; org: string }) {
  const rows = propertyIds.length
    ? await db.installment.findMany({
        where: { organizationId: org, contract: { propertyId: { in: propertyIds } }, status: { in: ["DUE", "OVERDUE", "PARTIALLY_PAID"] } },
        orderBy: { dueDate: "asc" },
        take: 100,
        include: { tenant: { select: { id: true, name: true } }, contract: { select: { id: true, code: true, unit: { select: { number: true } }, property: { select: { id: true, name: true } } } }, collectionCase: { select: { id: true, followUpStatus: true } } },
      })
    : [];
  const remaining = rows.reduce((s, i) => s + i.amount - i.paidAmount, 0);
  return (
    <Card padded={false} title={`المتأخرات على عقارات المالك (${rows.length})`} subtitle={`المتبقي: ${money(remaining)} ر.س`} actions={<Link href="/collections" className="link text-xs">قائمة التحصيل</Link>}>
      {rows.length === 0 ? (
        <EmptyState title="لا توجد مستحقات متأخرة" description="كل أقساط عقارات هذا المالك محصلة أو لم يحن موعدها." />
      ) : (
        <Table>
          <thead>
            <tr>
              <th>المستأجر</th>
              <th>العقار / الوحدة</th>
              <th>العقد</th>
              <th>الاستحقاق</th>
              <th className="num">المبلغ</th>
              <th className="num">المتبقي</th>
              <th>الحالة</th>
              <th>المتابعة</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((i) => (
              <tr key={i.id}>
                <td>
                  <Link href={`/tenants/${i.tenant.id}`} className="cell-primary hover:text-brand">
                    {i.tenant.name}
                  </Link>
                </td>
                <td>
                  {i.contract.property.name}
                  <div className="cell-sub latin">{i.contract.unit.number}</div>
                </td>
                <td className="latin">
                  <Link href={`/contracts/${i.contract.id}`} className="hover:text-brand">
                    {i.contract.code}
                  </Link>
                </td>
                <td>
                  {date(i.dueDate)}
                  {daysOverdue(i.dueDate) > 0 && <div className="cell-sub text-danger">متأخر {daysOverdue(i.dueDate)} يوم</div>}
                </td>
                <td className="num">{money(i.amount)}</td>
                <td className="num font-semibold">{money(i.amount - i.paidAmount)}</td>
                <td>
                  <StatusTag value={i.status} map={INSTALLMENT_STATUS} />
                </td>
                <td>
                  {i.collectionCase ? (
                    <Link href={`/collections/${i.collectionCase.id}`}>
                      <StatusTag value={i.collectionCase.followUpStatus} map={COLLECTION_STATUS} />
                    </Link>
                  ) : (
                    <span className="text-faint">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

async function ExpensesTab({ ownerId, propertyIds, org }: { ownerId: string; propertyIds: string[]; org: string }) {
  const rows = await db.expense.findMany({
    where: { organizationId: org, OR: [{ ownerId }, ...(propertyIds.length ? [{ propertyId: { in: propertyIds } }] : [])] },
    orderBy: { date: "desc" },
    take: 100,
    include: { property: { select: { id: true, name: true } }, unit: { select: { number: true } } },
  });
  const approved = rows.filter((e) => e.approvalStatus === "APPROVED").reduce((s, e) => s + e.amount + e.vatAmount, 0);
  return (
    <Card padded={false} title={`المصروفات (${rows.length})`} subtitle={`المعتمد: ${money(approved)} ر.س (قبل تطبيق نسبة الملكية)`}>
      {rows.length === 0 ? (
        <EmptyState title="لا توجد مصروفات" />
      ) : (
        <Table>
          <thead>
            <tr>
              <th>الرقم</th>
              <th>التاريخ</th>
              <th>الوصف</th>
              <th>العقار</th>
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
                <td>
                  <Link href={`/properties/${e.property.id}`} className="hover:text-brand">
                    {e.property.name}
                  </Link>
                </td>
                <td>{EXPENSE_CATEGORIES[e.category] ?? e.category}</td>
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

async function StatementsTab({ ownerId, org, canManage }: { ownerId: string; org: string; canManage: boolean }) {
  const rows = await db.ownerStatement.findMany({ where: { organizationId: org, ownerId }, orderBy: { periodEnd: "desc" }, include: { property: { select: { name: true } } } });
  const unpaid = rows.filter((s) => ["UNDER_REVIEW", "APPROVED"].includes(s.status)).reduce((s, x) => s + x.netDue, 0);
  return (
    <Card padded={false} title={`كشوف الحساب (${rows.length})`} subtitle={`قيد التحويل: ${money(unpaid)} ر.س`} actions={canManage ? <Link href={`/statements/new?ownerId=${ownerId}`} className="btn btn-primary btn-sm">+ تسوية</Link> : undefined}>
      {rows.length === 0 ? (
        <EmptyState title="لا توجد كشوف حساب" description="أنشئ كشف حساب للفترة لاحتساب صافي مستحقات المالك." action={canManage ? <Link href={`/statements/new?ownerId=${ownerId}`} className="btn btn-outline btn-sm">إنشاء تسوية</Link> : undefined} />
      ) : (
        <Table>
          <thead>
            <tr>
              <th>الرقم</th>
              <th>الفترة</th>
              <th>العقار</th>
              <th className="num">الإيجار المحصل</th>
              <th className="num">الأتعاب</th>
              <th className="num">المصروفات</th>
              <th className="num">صافي المستحق</th>
              <th>الحالة</th>
              <th>التحويل</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id}>
                <td>
                  <Link href={`/statements/${s.id}`} className="cell-primary latin hover:text-brand">
                    {s.code}
                  </Link>
                </td>
                <td>
                  {date(s.periodStart)} → {date(s.periodEnd)}
                </td>
                <td className="text-muted">{s.property?.name ?? "كل العقارات"}</td>
                <td className="num">{money(s.collectedRent)}</td>
                <td className="num">{money(s.managementFees)}</td>
                <td className="num">{money(s.expenses + s.otherDeductions)}</td>
                <td className="num font-bold">{money(s.netDue)}</td>
                <td>
                  <StatusTag value={s.status} map={STATEMENT_STATUS} />
                </td>
                <td>{s.paidAt ? date(s.paidAt) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

async function DocumentsTab({ ownerId, name, canManage }: { ownerId: string; name: string; canManage: boolean }) {
  const rows = await db.document.findMany({ where: { entityType: "OWNER", entityId: ownerId }, orderBy: { createdAt: "desc" } });
  const newHref = `/documents/new?entityType=OWNER&entityId=${ownerId}&entityLabel=${encodeURIComponent(name)}`;
  return (
    <Card padded={false} title="المستندات" actions={canManage ? <Link href={newHref} className="btn btn-primary btn-sm">+ مستند</Link> : undefined}>
      {rows.length === 0 ? (
        <EmptyState title="لا توجد مستندات" description="ارفع الهوية أو السجل التجاري واتفاقية الإدارة." action={canManage ? <Link href={newHref} className="btn btn-outline btn-sm">رفع مستند</Link> : undefined} />
      ) : (
        <Table>
          <thead>
            <tr>
              <th>المستند</th>
              <th>النوع</th>
              <th>الإصدار</th>
              <th>الانتهاء</th>
              <th className="num">النسخة</th>
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
                  <td>{DOCUMENT_TYPES[d.type] ?? d.type}</td>
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

async function ActivityTab({ ownerId }: { ownerId: string }) {
  const rows = await db.auditLog.findMany({ where: { entityType: "OWNER", entityId: ownerId }, orderBy: { createdAt: "desc" }, take: 50 });
  return (
    <Card title="سجل العمليات">
      {rows.length === 0 ? (
        <EmptyState title="لا توجد عمليات مسجلة" />
      ) : (
        <div className="timeline">
          {rows.map((a) => (
            <div key={a.id} className={`timeline-item ${a.action === "DELETE" || a.action === "ARCHIVE" ? "danger" : ""}`}>
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
