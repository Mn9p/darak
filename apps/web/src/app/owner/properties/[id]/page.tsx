import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOwner } from "@/lib/auth";
import { db } from "@/lib/db";
import { PROPERTY_TYPES, PROPERTY_STATUS, UNIT_STATUS, UNIT_TYPES, CONTRACT_STATUS, INSTALLMENT_STATUS, EXPENSE_CATEGORIES, DOCUMENT_TYPES } from "@/lib/constants";
import { money, pct, date, num, daysOverdue, relative, startOfYear } from "@/lib/format";
import { PageHeader, Card, Table, StatusTag, Tabs, DL, StatGrid, StatCard, EmptyState, Money } from "@/components/ui";
import { getOwnerScope } from "../../_scope";
import { getOrgSettings } from "@/lib/engine";
import { isArrears } from "@/lib/collections";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "overview", label: "نظرة عامة" },
  { key: "units", label: "الوحدات" },
  { key: "contracts", label: "العقود" },
  { key: "tenants", label: "المستأجرون" },
  { key: "collections", label: "التحصيل" },
  { key: "expenses", label: "المصروفات" },
  { key: "documents", label: "المستندات" },
];

export default async function OwnerPropertyPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const user = await requireOwner();
  const scope = await getOwnerScope(user);
  const { id } = await params;
  const { tab = "overview" } = await searchParams;
  if (!scope.propertyIds.includes(id)) notFound();

  const p = await db.property.findFirst({
    where: { id, organizationId: scope.org },
    include: {
      manager: { select: { name: true } },
      units: { where: { status: { not: "ARCHIVED" } }, orderBy: { number: "asc" } },
      contracts: { orderBy: { startDate: "desc" }, include: { tenant: { select: { id: true, name: true, type: true } }, unit: { select: { number: true } } } },
    },
  });
  if (!p) notFound();

  const contractIds = p.contracts.map((c) => c.id);
  const unitIds = p.units.map((u) => u.id);
  const yearStart = startOfYear();
  const [settings, installments, expenses, documents, ytdAlloc] = await Promise.all([
    getOrgSettings(scope.org),
    db.installment.findMany({ where: { organizationId: scope.org, contractId: { in: contractIds }, status: { notIn: ["PAID", "WAIVED"] } }, orderBy: { dueDate: "asc" }, include: { contract: { select: { code: true, paymentFrequency: true, unit: { select: { number: true } } } }, tenant: { select: { name: true } } } }),
    db.expense.findMany({ where: { organizationId: scope.org, propertyId: id, approvalStatus: "APPROVED" }, orderBy: { date: "desc" }, take: 100, include: { unit: { select: { number: true } } } }),
    db.document.findMany({
      where: {
        organizationId: scope.org,
        visibility: "OWNER",
        OR: [
          { entityType: "PROPERTY", entityId: id },
          { entityType: "CONTRACT", entityId: { in: contractIds } },
          { entityType: "UNIT", entityId: { in: unitIds } },
        ],
      },
      orderBy: { createdAt: "desc" },
    }),
    db.paymentAllocation.findMany({ where: { installment: { contractId: { in: contractIds } }, payment: { paidAt: { gte: yearStart }, status: { in: ["RECORDED", "APPROVED"] } } }, select: { amount: true, payment: { select: { paidAt: true } } } }),
  ]);

  const rented = p.units.filter((u) => u.status === "RENTED").length;
  const occupancy = p.units.length ? (rented / p.units.length) * 100 : 0;
  const annualRent = p.units.reduce((s, u) => s + (u.currentRent ?? 0), 0);
  const myPct = scope.pctOf(id);
  // Arrears = past the statutory grace only.
  const overdueRows = installments.filter((i) => isArrears(i, settings));
  const overdueAmt = overdueRows.reduce((s, i) => s + (i.amount - i.paidAmount), 0);
  const ytdIncome = ytdAlloc.reduce((s, a) => s + (a.amount * scope.pctOf(id, a.payment.paidAt)) / 100, 0);
  const ytdExp = expenses.filter((e) => e.date >= yearStart).reduce((s, e) => s + ((e.amount + e.vatAmount) * scope.pctOf(id, e.date)) / 100, 0);
  const activeContracts = p.contracts.filter((c) => ["ACTIVE", "EXPIRING_SOON", "RENEWAL_PENDING"].includes(c.status));
  const tenants = [...new Map(activeContracts.map((c) => [c.tenant.id, { ...c.tenant, unit: c.unit.number, contractCode: c.code, endDate: c.endDate }])).values()];

  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {p.name} <StatusTag value={p.status} map={PROPERTY_STATUS} />
          </span>
        }
        subtitle={<span className="latin">{p.code} · {PROPERTY_TYPES[p.type]} · {p.city ?? ""} {p.district ? `— ${p.district}` : ""}</span>}
        breadcrumbs={[{ label: "عقاراتي", href: "/owner/properties" }, { label: p.name }]}
      />

      <StatGrid cols={3}>
        <StatCard label="الإشغال" value={pct(occupancy, 0)} sub={`${num(rented)} من ${num(p.units.length)} وحدة · ملكيتك ${pct(myPct, 0)}`} />
        <StatCard label="صافي السنة (حصتك)" value={money(ytdIncome - ytdExp)} sub={`إيراد ${money(ytdIncome)} − مصروف ${money(ytdExp)}`} tone={ytdIncome - ytdExp >= 0 ? "success" : "danger"} />
        <StatCard label="المتأخرات" value={money(overdueAmt)} sub={`الإيجار السنوي ${money(annualRent)} ر.س`} tone={overdueAmt > 0 ? "danger" : undefined} />
      </StatGrid>

      <div className="mt-4">
        <Tabs tabs={TABS} active={tab} base={`/owner/properties/${p.id}`} />
      </div>

      {tab === "overview" && (
        <div className="grid gap-4 xl:grid-cols-3">
          <Card title="بيانات العقار" className="xl:col-span-2">
            <DL
              cols={3}
              items={[
                { label: "الرقم الداخلي", value: <span className="latin">{p.code}</span> },
                { label: "النوع", value: PROPERTY_TYPES[p.type] },
                { label: "مدير العقار", value: p.manager?.name },
                { label: "المدينة / الحي", value: [p.city, p.district].filter(Boolean).join(" — ") },
                { label: "الشارع", value: p.street },
                { label: "العنوان الوطني", value: p.nationalAddress },
                { label: "رقم الصك", value: p.deedNumber ? <span className="latin">{p.deedNumber}</span> : null },
                { label: "مساحة الأرض", value: p.landArea ? `${num(p.landArea)} م²` : null },
                { label: "مساحة البناء", value: p.buildingArea ? `${num(p.buildingArea)} م²` : null },
                { label: "عدد الأدوار", value: p.floors },
                { label: "سنة البناء", value: p.buildYear },
              ]}
            />
          </Card>
          <Card title="ملكيتك">
            <div className="space-y-2 text-[13.5px]">
              {scope.all
                .filter((o) => o.propertyId === id)
                .map((o, i) => (
                  <div key={i} className="flex items-center justify-between rounded-xl bg-mist px-3 py-2">
                    <span className="num font-bold">{pct(o.percentage, 0)}</span>
                    <span className="num text-[12px] text-muted">
                      {date(o.startDate)} — {o.endDate ? date(o.endDate) : "حتى الآن"}
                    </span>
                  </div>
                ))}
            </div>
          </Card>
        </div>
      )}

      {tab === "units" && (
        <Card padded={false}>
          {p.units.length === 0 ? (
            <EmptyState title="لا توجد وحدات" />
          ) : (
            <Table>
              <thead>
                <tr>
                  <th>الوحدة</th>
                  <th>النوع</th>
                  <th>الدور</th>
                  <th>المساحة</th>
                  <th>الإيجار الحالي</th>
                  <th>الحالة</th>
                </tr>
              </thead>
              <tbody>
                {p.units.map((u) => (
                  <tr key={u.id}>
                    <td className="font-bold">{u.number}</td>
                    <td>{UNIT_TYPES[u.type] ?? u.type}</td>
                    <td>{u.floor ?? "—"}</td>
                    <td className="num">{u.area ? `${num(u.area)} م²` : "—"}</td>
                    <td className="num"><Money value={u.currentRent ?? u.targetRent} /></td>
                    <td><StatusTag value={u.status} map={UNIT_STATUS} /></td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      )}

      {tab === "contracts" && (
        <Card padded={false}>
          {p.contracts.length === 0 ? (
            <EmptyState title="لا توجد عقود على هذا العقار" />
          ) : (
            <Table>
              <thead>
                <tr>
                  <th>العقد</th>
                  <th>الوحدة</th>
                  <th>المستأجر</th>
                  <th>من</th>
                  <th>إلى</th>
                  <th>القيمة السنوية</th>
                  <th>الحالة</th>
                </tr>
              </thead>
              <tbody>
                {p.contracts.map((c) => (
                  <tr key={c.id}>
                    <td className="latin">{c.code}</td>
                    <td>{c.unit.number}</td>
                    <td>{c.tenant.name}</td>
                    <td className="num">{date(c.startDate)}</td>
                    <td className="num">{date(c.endDate)}</td>
                    <td className="num">{money(c.totalAmount)}</td>
                    <td><StatusTag value={c.status} map={CONTRACT_STATUS} /></td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      )}

      {tab === "tenants" && (
        <Card padded={false} title="المستأجرون الحاليون" subtitle="تُعرض الأسماء فقط حفاظًا على خصوصية بيانات المستأجرين">
          {tenants.length === 0 ? (
            <EmptyState title="لا يوجد مستأجرون حاليون" />
          ) : (
            <Table>
              <thead>
                <tr>
                  <th>المستأجر</th>
                  <th>الوحدة</th>
                  <th>العقد</th>
                  <th>نهاية العقد</th>
                </tr>
              </thead>
              <tbody>
                {tenants.map((t) => (
                  <tr key={t.id}>
                    <td className="font-bold">{t.name}</td>
                    <td>{t.unit}</td>
                    <td className="latin">{t.contractCode}</td>
                    <td className="num">{date(t.endDate)} <span className="text-[11px] text-muted">({relative(t.endDate)})</span></td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      )}

      {tab === "collections" && (
        <Card padded={false} title="الأقساط غير المسددة" subtitle={`المتأخر: ${money(overdueAmt)} ر.س`}>
          {installments.length === 0 ? (
            <EmptyState title="لا توجد أقساط غير مسددة" />
          ) : (
            <Table>
              <thead>
                <tr>
                  <th>العقد</th>
                  <th>الوحدة</th>
                  <th>المستأجر</th>
                  <th>الاستحقاق</th>
                  <th>المبلغ</th>
                  <th>المسدد</th>
                  <th>المتبقي</th>
                  <th>أيام التأخر</th>
                  <th>الحالة</th>
                </tr>
              </thead>
              <tbody>
                {installments.map((i) => (
                  <tr key={i.id}>
                    <td className="latin">{i.contract.code}</td>
                    <td>{i.contract.unit.number}</td>
                    <td>{i.tenant.name}</td>
                    <td className="num">{date(i.dueDate)}</td>
                    <td className="num">{money(i.amount)}</td>
                    <td className="num">{money(i.paidAmount)}</td>
                    <td className="num font-bold">{money(i.amount - i.paidAmount)}</td>
                    <td className="num">{daysOverdue(i.dueDate) || "—"}</td>
                    <td><StatusTag value={i.status} map={INSTALLMENT_STATUS} /></td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      )}

      {tab === "expenses" && (
        <Card padded={false} title="المصروفات المعتمدة" subtitle="حصتك محسوبة حسب نسبة ملكيتك في تاريخ المصروف">
          {expenses.length === 0 ? (
            <EmptyState title="لا توجد مصروفات معتمدة" />
          ) : (
            <Table>
              <thead>
                <tr>
                  <th>الرقم</th>
                  <th>التاريخ</th>
                  <th>الوصف</th>
                  <th>الفئة</th>
                  <th>الوحدة</th>
                  <th>المبلغ شامل الضريبة</th>
                  <th>حصتك</th>
                </tr>
              </thead>
              <tbody>
                {expenses.map((e) => (
                  <tr key={e.id}>
                    <td className="latin">{e.code}</td>
                    <td className="num">{date(e.date)}</td>
                    <td>{e.description}</td>
                    <td>{EXPENSE_CATEGORIES[e.category] ?? e.category}</td>
                    <td>{e.unit?.number ?? "—"}</td>
                    <td className="num">{money(e.amount + e.vatAmount)}</td>
                    <td className="num font-bold">{money(((e.amount + e.vatAmount) * scope.pctOf(id, e.date)) / 100)}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      )}

      {tab === "documents" && (
        <Card padded={false}>
          {documents.length === 0 ? (
            <EmptyState title="لا توجد مستندات مشاركة معك" description="يظهر هنا ما يشاركه المكتب معك من مستندات هذا العقار." />
          ) : (
            <Table>
              <thead>
                <tr>
                  <th>المستند</th>
                  <th>النوع</th>
                  <th>مرتبط بـ</th>
                  <th>تاريخ الانتهاء</th>
                  <th>أضيف</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {documents.map((d) => (
                  <tr key={d.id}>
                    <td className="font-bold">{d.name}</td>
                    <td>{DOCUMENT_TYPES[d.type] ?? d.type}</td>
                    <td>{d.entityLabel ?? "—"}</td>
                    <td className="num">{date(d.expiryDate)}</td>
                    <td className="num">{date(d.createdAt)}</td>
                    <td>{d.url ? <a className="link" href={d.url} target="_blank">فتح</a> : <span className="text-faint">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      )}
    </>
  );
}
