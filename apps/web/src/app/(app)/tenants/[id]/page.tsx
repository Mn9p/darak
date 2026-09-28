import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { can, isScoped } from "@/lib/permissions";
import { displayPhone, isValidPhone, telHref } from "@/lib/phone";
import { PARTY_TYPES, OWNER_STATUS, RISK_LEVELS, CONTRACT_STATUS, INSTALLMENT_STATUS, PAYMENT_STATUS, PAYMENT_METHODS, COLLECTION_STATUS, COLLECTION_ACTION_TYPES, COLLECTION_OUTCOMES, DOCUMENT_TYPES, AUDIT_ACTIONS, PAYMENT_FREQUENCY } from "@/lib/constants";
import { money, num, pct, date, datetime, daysFromToday, daysOverdue, tagsToArray, relative } from "@/lib/format";
import { HeroHeader, Card, Table, StatusTag, Tabs, DL, StatGrid, StatCard, EmptyState, Tag, ActionButton, KV, Progress, Avatar, Select, Input, Alert } from "@/components/ui";
import { archiveTenant, restoreTenant, setRisk } from "../actions";

export const dynamic = "force-dynamic";

const ACTIVE_CONTRACT = ["ACTIVE", "EXPIRING_SOON", "RENEWAL_PENDING"];
const OVERDUE = ["OVERDUE", "PARTIALLY_PAID"];
const TENANT_STATUS = OWNER_STATUS; // ACTIVE | INACTIVE | ARCHIVED

const TABS = [
  { key: "overview", label: "نظرة عامة" },
  { key: "contracts", label: "العقود" },
  { key: "installments", label: "الدفعات" },
  { key: "payments", label: "سندات القبض" },
  { key: "collections", label: "سجل التحصيل" },
  { key: "documents", label: "المستندات" },
  { key: "activity", label: "الملاحظات والعمليات" },
];

export default async function TenantPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const user = await requireStaff();
  const { id } = await params;
  const { tab = "overview" } = await searchParams;
  const org = user.organizationId;
  const scope = isScoped(user) ? { contracts: { some: { propertyId: { in: user.assignedPropertyIds } } } } : {};

  const t = await db.tenant.findFirst({
    where: { id, organizationId: org, ...scope },
    include: {
      portalUser: { select: { id: true, phone: true, lastLoginAt: true } },
      contracts: {
        orderBy: { startDate: "desc" },
        include: {
          unit: { select: { id: true, number: true } },
          property: { select: { id: true, name: true } },
          installments: { select: { amount: true, paidAmount: true, status: true, dueDate: true } },
        },
      },
    },
  });
  if (!t) notFound();

  const current = t.contracts.filter((c) => ACTIVE_CONTRACT.includes(c.status));
  const previous = t.contracts.filter((c) => !ACTIVE_CONTRACT.includes(c.status));
  const allInst = t.contracts.flatMap((c) => c.installments).filter((i) => i.status !== "WAIVED");
  const totalDue = allInst.reduce((s, i) => s + i.amount, 0);
  const totalPaid = allInst.reduce((s, i) => s + i.paidAmount, 0);
  const overdueRows = allInst.filter((i) => OVERDUE.includes(i.status));
  const overdue = overdueRows.reduce((s, i) => s + i.amount - i.paidAmount, 0);
  const maxLate = overdueRows.reduce((m, i) => Math.max(m, daysOverdue(i.dueDate)), 0);
  const collectionRate = totalDue ? (totalPaid / totalDue) * 100 : 0;
  const idLeft = t.idExpiry ? daysFromToday(t.idExpiry) : null;

  const [openCases, docsCount] = await Promise.all([
    db.collectionCase.count({ where: { organizationId: org, installment: { tenantId: id }, followUpStatus: { notIn: ["PAID", "CLOSED"] } } }),
    db.document.count({ where: { organizationId: org, entityType: "TENANT", entityId: id } }),
  ]);
  const canManage = can(user, "tenants.manage");

  return (
    <>
      <HeroHeader
        avatar={<Avatar name={t.name} sand />}
        title={t.name}
        code={t.code}
        status={
          <>
            <StatusTag value={t.status} map={TENANT_STATUS} />
            <StatusTag value={t.riskLevel} map={RISK_LEVELS} />
            {t.type === "COMPANY" && !t.crNumber && (
              <Tag tone="neutral" plain>
                السجل التجاري غير مسجل
              </Tag>
            )}
            {tagsToArray(t.tags).map((x) => (
              <Tag key={x} tone="brand" plain>
                {x}
              </Tag>
            ))}
          </>
        }
        meta={[
          <span key="type">{PARTY_TYPES[t.type] ?? t.type}</span>,
          t.phone && (
            <a key="phone" className="link num" href={telHref(t.phone)}>
              {displayPhone(t.phone)}
            </a>
          ),
          t.portalUser ? <span key="portal">حساب البوابة مفعّل</span> : isValidPhone(t.phone) ? <span key="portal">البوابة جاهزة برقم الجوال</span> : null,
          current.length > 0 && (
            <span key="unit">
              الوحدة <Link href={`/units/${current[0].unit.id}`} className="link latin">{current[0].unit.number}</Link> — <Link href={`/properties/${current[0].property.id}`} className="link">{current[0].property.name}</Link>
            </span>
          ),
        ]}
        breadcrumbs={[{ label: "المستأجرون", href: "/tenants" }, { label: t.name }]}
        actions={
          <>
            {can(user, "contracts.manage") && t.status !== "ARCHIVED" && (
              <Link href={`/contracts/new?tenantId=${t.id}`} className="btn btn-accent btn-sm">
                + عقد جديد
              </Link>
            )}
            {can(user, "payments.manage") && (
              <Link href={`/payments/new?tenantId=${t.id}`} className="btn btn-outline btn-sm">
                تسجيل دفعة
              </Link>
            )}
            {can(user, "tasks.manage") && (
              <Link href={`/tasks/new?entityType=TENANT&entityId=${t.id}&entityLabel=${encodeURIComponent(t.name)}`} className="btn btn-ghost btn-sm">
                مهمة
              </Link>
            )}
            {canManage && t.status !== "ARCHIVED" && (
              <Link href={`/tenants/${t.id}/edit`} className="btn btn-primary btn-sm">
                تعديل
              </Link>
            )}
          </>
        }
      />

      {idLeft !== null && idLeft <= 30 && (
        <div className="mb-4">
          <Alert tone={idLeft < 0 ? "danger" : "warning"}>{idLeft < 0 ? `هوية المستأجر منتهية منذ ${-idLeft} يوم.` : `تنتهي هوية المستأجر خلال ${idLeft} يوم — يُنصح بتحديث المستندات قبل التجديد.`}</Alert>
        </div>
      )}

      <StatGrid cols={6}>
        <StatCard label="عقود نشطة" value={num(current.length)} tone={current.length ? "success" : undefined} href={`/tenants/${t.id}?tab=contracts`} />
        <StatCard label="إجمالي المستحق" value={money(totalDue)} sub={`${allInst.length} قسط`} />
        <StatCard label="إجمالي المدفوع" value={money(totalPaid)} tone="success" href={`/tenants/${t.id}?tab=payments`} />
        <StatCard label="المتأخرات" value={money(overdue)} tone={overdue > 0 ? "danger" : undefined} sub={maxLate > 0 ? `أقصى تأخر: ${maxLate} يوم` : undefined} href={`/tenants/${t.id}?tab=installments`} />
        <StatCard label="نسبة السداد" value={pct(collectionRate)} sub={<Progress value={collectionRate} tone={collectionRate < 75 ? "danger" : collectionRate < 90 ? "warn" : undefined} />} />
        <StatCard label="مطالبات مفتوحة" value={num(openCases)} tone={openCases > 0 ? "warning" : undefined} href={`/tenants/${t.id}?tab=collections`} dark />
      </StatGrid>

      <div className="mt-4">
        <Tabs tabs={TABS.map((x) => (x.key === "contracts" ? { ...x, count: t.contracts.length } : x.key === "documents" ? { ...x, count: docsCount } : x))} active={tab} base={`/tenants/${t.id}`} sticky />
      </div>

      {tab === "overview" && (
        <div className="grid gap-4 xl:grid-cols-3">
          <div className="space-y-4 xl:col-span-2">
            <Card title="العقود الحالية" tone={current.length ? "warm" : "light"}>
              {current.length === 0 ? (
                <EmptyState
                  title="لا يوجد عقد نشط"
                  description={previous.length ? "المستأجر لديه عقود سابقة فقط." : "أنشئ عقدًا على وحدة لبدء جدول الأقساط."}
                  action={can(user, "contracts.manage") && t.status !== "ARCHIVED" ? <Link href={`/contracts/new?tenantId=${t.id}`} className="btn btn-primary btn-sm">+ عقد جديد</Link> : undefined}
                />
              ) : (
                <div className="space-y-3">
                  {current.map((c) => {
                    const due = c.installments.filter((i) => i.status !== "WAIVED").reduce((s, i) => s + i.amount, 0);
                    const paid = c.installments.reduce((s, i) => s + i.paidAmount, 0);
                    const late = c.installments.filter((i) => OVERDUE.includes(i.status)).reduce((s, i) => s + i.amount - i.paidAmount, 0);
                    const toEnd = daysFromToday(c.endDate);
                    return (
                      <div key={c.id} className="rounded-xl bg-white/70 p-4">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <Link href={`/contracts/${c.id}`} className="latin text-base font-bold hover:text-brand">
                                {c.code}
                              </Link>
                              <StatusTag value={c.status} map={CONTRACT_STATUS} />
                            </div>
                            <div className="mt-1 text-[13px] text-muted">
                              <Link href={`/properties/${c.property.id}`} className="hover:text-brand">
                                {c.property.name}
                              </Link>
                              {" · الوحدة "}
                              <Link href={`/units/${c.unit.id}`} className="latin hover:text-brand">
                                {c.unit.number}
                              </Link>
                              {" · "}
                              {date(c.startDate)} → {date(c.endDate)}
                              <span className={toEnd <= 30 ? "text-danger" : ""}> ({toEnd >= 0 ? `يتبقى ${toEnd} يوم` : `انتهى قبل ${-toEnd} يوم`})</span>
                            </div>
                          </div>
                          <div className="text-left">
                            <div className="num text-lg font-bold">{money(c.totalAmount)}</div>
                            <div className="text-[11.5px] text-muted">{PAYMENT_FREQUENCY[c.paymentFrequency] ?? c.paymentFrequency} · {c.installmentsCount} قسط</div>
                          </div>
                        </div>
                        <div className="mt-3 grid grid-cols-3 gap-2">
                          <Mini label="المحصل" v={money(paid)} tone="text-success" />
                          <Mini label="المتبقي" v={money(due - paid)} />
                          <Mini label="المتأخر" v={money(late)} tone={late > 0 ? "text-danger" : ""} />
                        </div>
                        <div className="mt-2">
                          <Progress value={due ? (paid / due) * 100 : 0} tone={late > 0 ? "danger" : undefined} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>

            <Card title="الملف الشخصي">
              <div className="mb-4 flex items-center gap-3">
                <Avatar name={t.name} />
                <div>
                  <div className="font-bold">{t.name}</div>
                  <div className="text-xs text-muted">
                    {PARTY_TYPES[t.type] ?? t.type} · مسجل منذ {date(t.createdAt)}
                  </div>
                </div>
              </div>
              <DL
                cols={3}
                items={[
                  { label: "الرقم الداخلي", value: <span className="latin">{t.code}</span> },
                  ...(t.type === "COMPANY"
                    ? [
                        { label: "السجل التجاري", value: t.crNumber ? <span className="latin">{t.crNumber}</span> : null },
                        { label: "الرقم الضريبي", value: t.vatNumber ? <span className="latin">{t.vatNumber}</span> : null },
                        { label: "الممثل / المفوض", value: t.representative },
                      ]
                    : [
                        { label: "رقم الهوية", value: t.nationalId ? <span className="latin">{t.nationalId}</span> : null },
                        { label: "انتهاء الهوية", value: t.idExpiry ? <span className={idLeft !== null && idLeft < 0 ? "text-danger" : idLeft !== null && idLeft <= 30 ? "text-warning" : ""}>{date(t.idExpiry)}</span> : null },
                        { label: "جهة العمل", value: t.employer },
                      ]),
                  { label: "الجوال", value: t.phone ? <a className="link num" href={telHref(t.phone)}>{displayPhone(t.phone)}</a> : null },
                  { label: "البريد الإلكتروني", value: t.email ? <a className="link latin" href={`mailto:${t.email}`}>{t.email}</a> : null },
                  { label: "العنوان", value: t.address },
                  { label: "جهة اتصال بديلة", value: t.altContactName ? <span>{t.altContactName}{t.altContactPhone && <span className="latin text-muted"> · {t.altContactPhone}</span>}</span> : null },
                  {
                    label: "حساب البوابة",
                    value: t.portalUser ? (
                      <span>
                        مفعّل · آخر دخول <span className="num">{t.portalUser.lastLoginAt ? datetime(t.portalUser.lastLoginAt) : "—"}</span>
                      </span>
                    ) : isValidPhone(t.phone) ? (
                      <span>
                        يدخل برقم <span className="num">{displayPhone(t.phone)}</span> عند أول تسجيل دخول
                      </span>
                    ) : (
                      "أضف رقم جوال لتفعيل البوابة"
                    ),
                  },
                  { label: "آخر تحديث", value: date(t.updatedAt) },
                ]}
              />
              {t.notes && <p className="mt-4 rounded-xl bg-mist px-4 py-3 text-[13px] text-text-2 whitespace-pre-line">{t.notes}</p>}
            </Card>

            {previous.length > 0 && (
              <Card padded={false} title={`العقود السابقة (${previous.length})`}>
                <ContractsTable rows={previous} />
              </Card>
            )}
          </div>

          <div className="space-y-4">
            <Card title="مؤشرات سريعة">
              <KV k="إجمالي العقود" v={<span className="num">{t.contracts.length}</span>} />
              <KV k="أقساط متأخرة" v={<span className={`num ${overdueRows.length > 0 ? "text-danger" : ""}`}>{overdueRows.length}</span>} />
              <KV k="مطالبات مفتوحة" v={<Link href={`/tenants/${t.id}?tab=collections`} className="num link">{openCases}</Link>} />
              <KV k="المستندات" v={<span className="num">{docsCount}</span>} />
            </Card>

            {canManage && (
              <Card title="تصنيف المخاطر" subtitle="يؤثر على أولوية مطالبات التحصيل">
                <form action={setRisk} className="space-y-2">
                  <input type="hidden" name="id" value={t.id} />
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] text-muted">الحالي:</span>
                    <StatusTag value={t.riskLevel} map={RISK_LEVELS} />
                  </div>
                  <Select name="riskLevel" options={RISK_LEVELS} defaultValue={t.riskLevel} />
                  <Input name="reason" placeholder="سبب التغيير (اختياري)" />
                  <button type="submit" className="btn btn-outline btn-sm w-full">
                    تحديث المخاطر
                  </button>
                </form>
              </Card>
            )}

            {canManage && (
              <Card title="إجراءات">
                {t.status === "ARCHIVED" ? (
                  <ActionButton action={restoreTenant} hidden={{ id: t.id }} className="btn btn-outline btn-sm">
                    استعادة المستأجر
                  </ActionButton>
                ) : (
                  <>
                    <ActionButton action={archiveTenant} hidden={{ id: t.id }} className="btn btn-danger-soft btn-sm" confirm="أرشفة المستأجر؟ يبقى سجله وعقوده محفوظة ويمكن استعادته لاحقًا.">
                      أرشفة المستأجر
                    </ActionButton>
                    <p className="help mt-2">تتطلب الأرشفة عدم وجود عقود نشطة أو أقساط مستحقة. لا تُحذف البيانات التاريخية.</p>
                  </>
                )}
              </Card>
            )}
          </div>
        </div>
      )}

      {tab === "contracts" && (
        <div className="space-y-4">
          <Card padded={false} title={`العقود الحالية (${current.length})`}>
            {current.length === 0 ? <EmptyState title="لا يوجد عقد نشط" /> : <ContractsTable rows={current} />}
          </Card>
          <Card padded={false} title={`العقود السابقة (${previous.length})`}>
            {previous.length === 0 ? <EmptyState title="لا توجد عقود سابقة" /> : <ContractsTable rows={previous} />}
          </Card>
        </div>
      )}
      {tab === "installments" && <InstallmentsTab tenantId={t.id} />}
      {tab === "payments" && <PaymentsTab tenantId={t.id} canManage={can(user, "payments.manage")} />}
      {tab === "collections" && <CollectionsTab tenantId={t.id} org={org} />}
      {tab === "documents" && <DocumentsTab tenantId={t.id} name={t.name} canManage={can(user, "documents.manage")} />}
      {tab === "activity" && <ActivityTab tenantId={t.id} notes={t.notes} />}
    </>
  );
}

/* ───────── Tabs ───────── */

type ContractRow = {
  id: string;
  code: string;
  startDate: Date;
  endDate: Date;
  totalAmount: number;
  status: string;
  paymentFrequency: string;
  unit: { id: string; number: string };
  property: { id: string; name: string };
  installments: { amount: number; paidAmount: number; status: string }[];
};

function ContractsTable({ rows }: { rows: ContractRow[] }) {
  return (
    <Table>
      <thead>
        <tr>
          <th>العقد</th>
          <th>العقار / الوحدة</th>
          <th>البداية</th>
          <th>النهاية</th>
          <th>الدورية</th>
          <th className="num">القيمة</th>
          <th className="num">المحصل</th>
          <th>الحالة</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((c) => {
          const paid = c.installments.reduce((s, i) => s + i.paidAmount, 0);
          return (
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
              <td>{date(c.startDate)}</td>
              <td>
                {date(c.endDate)}
                {ACTIVE_CONTRACT.includes(c.status) && <div className="cell-sub">بعد {daysFromToday(c.endDate)} يوم</div>}
              </td>
              <td>{PAYMENT_FREQUENCY[c.paymentFrequency] ?? c.paymentFrequency}</td>
              <td className="num font-semibold">{money(c.totalAmount)}</td>
              <td className="num">{money(paid)}</td>
              <td>
                <StatusTag value={c.status} map={CONTRACT_STATUS} />
              </td>
            </tr>
          );
        })}
      </tbody>
    </Table>
  );
}

async function InstallmentsTab({ tenantId }: { tenantId: string }) {
  const rows = await db.installment.findMany({
    where: { tenantId },
    orderBy: [{ dueDate: "desc" }],
    take: 150,
    include: { contract: { select: { id: true, code: true, unit: { select: { number: true } } } }, collectionCase: { select: { id: true, followUpStatus: true } } },
  });
  const open = rows.filter((i) => !["PAID", "WAIVED"].includes(i.status));
  const overdueAmt = rows.filter((i) => OVERDUE.includes(i.status)).reduce((s, i) => s + i.amount - i.paidAmount, 0);
  return (
    <Card padded={false} title={`الأقساط (${rows.length})`} subtitle={`مفتوحة: ${open.length} · متأخر: ${money(overdueAmt)} ر.س`}>
      {rows.length === 0 ? (
        <EmptyState title="لا توجد أقساط" description="تُنشأ الأقساط تلقائيًا عند إنشاء عقد للمستأجر." />
      ) : (
        <Table>
          <thead>
            <tr>
              <th>العقد</th>
              <th className="num">#</th>
              <th>الوحدة</th>
              <th>الاستحقاق</th>
              <th className="num">المبلغ</th>
              <th className="num">المدفوع</th>
              <th className="num">المتبقي</th>
              <th>الحالة</th>
              <th>المطالبة</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((i) => {
              const late = daysOverdue(i.dueDate);
              return (
                <tr key={i.id}>
                  <td className="latin">
                    <Link href={`/contracts/${i.contract.id}`} className="hover:text-brand">
                      {i.contract.code}
                    </Link>
                  </td>
                  <td className="num">{i.seq}</td>
                  <td className="latin">{i.contract.unit.number}</td>
                  <td>
                    {date(i.dueDate)}
                    {late > 0 && !["PAID", "WAIVED"].includes(i.status) && <div className="cell-sub text-danger">متأخر {late} يوم</div>}
                  </td>
                  <td className="num">{money(i.amount)}</td>
                  <td className="num">{money(i.paidAmount)}</td>
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
              );
            })}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

async function PaymentsTab({ tenantId, canManage }: { tenantId: string; canManage: boolean }) {
  const rows = await db.payment.findMany({
    where: { tenantId },
    orderBy: { paidAt: "desc" },
    take: 100,
    include: { contract: { select: { id: true, code: true } }, recordedBy: { select: { name: true } }, allocations: { select: { amount: true } } },
  });
  const total = rows.filter((p) => ["RECORDED", "APPROVED"].includes(p.status)).reduce((s, p) => s + p.amount, 0);
  return (
    <Card padded={false} title={`سندات القبض (${rows.length})`} subtitle={`إجمالي المسجل/المعتمد: ${money(total)} ر.س`} actions={canManage ? <Link href={`/payments/new?tenantId=${tenantId}`} className="btn btn-primary btn-sm">+ دفعة</Link> : undefined}>
      {rows.length === 0 ? (
        <EmptyState title="لا توجد مدفوعات" action={canManage ? <Link href={`/payments/new?tenantId=${tenantId}`} className="btn btn-outline btn-sm">تسجيل دفعة</Link> : undefined} />
      ) : (
        <Table>
          <thead>
            <tr>
              <th>الدفعة</th>
              <th>التاريخ</th>
              <th>العقد</th>
              <th>الطريقة</th>
              <th className="num">المبلغ</th>
              <th className="num">المخصص</th>
              <th>سجلها</th>
              <th>الحالة</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id}>
                <td>
                  <Link href={`/payments/${p.id}`} className="cell-primary latin hover:text-brand">
                    {p.code}
                  </Link>
                  {p.reference && <div className="cell-sub latin">{p.reference}</div>}
                </td>
                <td>{date(p.paidAt)}</td>
                <td className="latin">{p.contract ? <Link href={`/contracts/${p.contract.id}`} className="hover:text-brand">{p.contract.code}</Link> : "—"}</td>
                <td>{PAYMENT_METHODS[p.method] ?? p.method}</td>
                <td className="num font-semibold">{money(p.amount)}</td>
                <td className="num">{money(p.allocations.reduce((s, a) => s + a.amount, 0))}</td>
                <td className="text-muted">{p.recordedBy?.name ?? "—"}</td>
                <td>
                  <StatusTag value={p.status} map={PAYMENT_STATUS} />
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

async function CollectionsTab({ tenantId, org }: { tenantId: string; org: string }) {
  const [cases, actions] = await Promise.all([
    db.collectionCase.findMany({
      where: { organizationId: org, installment: { tenantId } },
      orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
      include: { installment: { select: { seq: true, amount: true, paidAmount: true, dueDate: true, contract: { select: { code: true } } } }, collector: { select: { name: true } } },
    }),
    db.collectionAction.findMany({
      where: { case: { organizationId: org, installment: { tenantId } } },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { byUser: { select: { name: true } }, case: { select: { id: true, installment: { select: { seq: true, contract: { select: { code: true } } } } } } },
    }),
  ]);
  const open = cases.filter((k) => !["PAID", "CLOSED"].includes(k.followUpStatus));
  const broken = cases.reduce((s, k) => s + k.brokenPromises, 0);
  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <Card title="سجل التحصيل" subtitle="كل إجراءات المتابعة على مطالبات هذا المستأجر" className="xl:col-span-2">
        {actions.length === 0 ? (
          <EmptyState title="لا توجد إجراءات تحصيل" description="تُفتح المطالبات تلقائيًا عند تأخر أي قسط." />
        ) : (
          <div className="timeline">
            {actions.map((a) => (
              <div key={a.id} className={`timeline-item ${a.type === "ESCALATION" || a.outcome === "REFUSED" ? "danger" : a.type === "PROMISE" ? "warning" : a.type === "SYSTEM" ? "neutral" : ""}`}>
                <div className="text-[13px]">
                  <b>{COLLECTION_ACTION_TYPES[a.type] ?? a.type}</b>
                  {a.outcome && <span className="text-muted"> · {COLLECTION_OUTCOMES[a.outcome] ?? a.outcome}</span>}
                  <span className="text-muted">
                    {" · "}
                    <Link href={`/collections/${a.case.id}`} className="latin hover:text-brand">
                      {a.case.installment.contract.code} / {a.case.installment.seq}
                    </Link>
                  </span>
                </div>
                {a.note && <div className="mt-0.5 text-[12.5px] text-text-2">{a.note}</div>}
                <div className="text-[11.5px] text-faint">
                  {a.byUser?.name ?? "النظام"} · {datetime(a.createdAt)}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
      <div className="space-y-4">
        <Card title="ملخص" tone="dark">
          <KV k="مطالبات مفتوحة" v={<span className="num">{open.length}</span>} />
          <KV k="إجمالي المطالبات" v={<span className="num">{cases.length}</span>} />
          <KV k="وعود مكسورة" v={<span className={`num ${broken > 0 ? "text-danger" : ""}`}>{broken}</span>} />
        </Card>
        <Card padded={false} title="المطالبات">
          {cases.length === 0 ? (
            <EmptyState title="لا توجد مطالبات" />
          ) : (
            <Table>
              <thead>
                <tr>
                  <th>القسط</th>
                  <th className="num">المتبقي</th>
                  <th>الحالة</th>
                  <th>التالي</th>
                </tr>
              </thead>
              <tbody>
                {cases.map((k) => (
                  <tr key={k.id}>
                    <td>
                      <Link href={`/collections/${k.id}`} className="cell-primary latin hover:text-brand">
                        {k.installment.contract.code} / {k.installment.seq}
                      </Link>
                      <div className="cell-sub">{daysOverdue(k.installment.dueDate) > 0 ? `متأخر ${daysOverdue(k.installment.dueDate)} يوم` : date(k.installment.dueDate)}</div>
                    </td>
                    <td className="num font-semibold">{money(k.installment.amount - k.installment.paidAmount)}</td>
                    <td>
                      <StatusTag value={k.followUpStatus} map={COLLECTION_STATUS} />
                    </td>
                    <td className="text-[12px] text-muted">{k.promiseDate ? `وعد ${relative(k.promiseDate)}` : k.nextActionDate ? relative(k.nextActionDate) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    </div>
  );
}

async function DocumentsTab({ tenantId, name, canManage }: { tenantId: string; name: string; canManage: boolean }) {
  const rows = await db.document.findMany({ where: { entityType: "TENANT", entityId: tenantId }, orderBy: { createdAt: "desc" } });
  const newHref = `/documents/new?entityType=TENANT&entityId=${tenantId}&entityLabel=${encodeURIComponent(name)}`;
  return (
    <Card padded={false} title="المستندات" actions={canManage ? <Link href={newHref} className="btn btn-primary btn-sm">+ مستند</Link> : undefined}>
      {rows.length === 0 ? (
        <EmptyState title="لا توجد مستندات" description="ارفع الهوية أو السجل التجاري وأي وثائق مرتبطة بالمستأجر." action={canManage ? <Link href={newHref} className="btn btn-outline btn-sm">رفع مستند</Link> : undefined} />
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

async function ActivityTab({ tenantId, notes }: { tenantId: string; notes: string | null }) {
  const rows = await db.auditLog.findMany({ where: { entityType: "TENANT", entityId: tenantId }, orderBy: { createdAt: "desc" }, take: 50 });
  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <Card title="سجل العمليات" className="xl:col-span-2">
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
      <Card title="الملاحظات الداخلية">
        {notes ? <p className="whitespace-pre-line text-[13px] text-text-2">{notes}</p> : <p className="text-[13px] text-muted">لا توجد ملاحظات. أضفها من صفحة التعديل.</p>}
      </Card>
    </div>
  );
}

function Mini({ label, v, tone = "" }: { label: string; v: string; tone?: string }) {
  return (
    <div className="rounded-lg bg-mist px-3 py-2">
      <div className="text-[11.5px] text-muted">{label}</div>
      <div className={`num text-base font-bold ${tone}`}>{v}</div>
    </div>
  );
}
