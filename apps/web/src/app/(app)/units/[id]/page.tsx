import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { can, propertyIdScope } from "@/lib/permissions";
import { UNIT_TYPES, UNIT_USAGE, UNIT_STATUS, CONTRACT_STATUS, INSTALLMENT_STATUS, PAYMENT_STATUS, PAYMENT_METHODS, DOCUMENT_TYPES, AUDIT_ACTIONS, RISK_LEVELS, PAYMENT_FREQUENCY } from "@/lib/constants";
import { money, num, date, datetime, daysFromToday, daysOverdue, tagsToArray } from "@/lib/format";
import { HeroHeader, Card, Table, StatusTag, Tabs, DL, StatGrid, StatCard, EmptyState, Tag, ActionButton, KV } from "@/components/ui";
import { MoreMenu } from "@/components/MoreMenu";
import { archiveUnit, restoreUnit, setUnitStatus } from "../actions";
import { displayPhone } from "@/lib/phone";

export const dynamic = "force-dynamic";

const ACTIVE_CONTRACT = ["ACTIVE", "EXPIRING_SOON", "RENEWAL_PENDING"];

const TABS = [
  { key: "overview", label: "نظرة عامة" },
  { key: "contracts", label: "العقود" },
  { key: "installments", label: "الأقساط والتحصيل" },
  { key: "payments", label: "سندات القبض" },
  { key: "documents", label: "المستندات" },
  { key: "activity", label: "سجل العمليات" },
];

export default async function UnitPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const user = await requireStaff();
  const { id } = await params;
  const { tab = "overview" } = await searchParams;
  const org = user.organizationId;

  const u = await db.unit.findFirst({
    where: { id, organizationId: org, ...propertyIdScope(user) },
    include: {
      property: { select: { id: true, name: true, code: true, city: true, district: true, status: true, ownerships: { where: { endDate: null }, include: { owner: { select: { id: true, name: true } } } } } },
      contracts: {
        orderBy: { startDate: "desc" },
        include: { tenant: { select: { id: true, name: true, phone: true, riskLevel: true, type: true } }, installments: { select: { amount: true, paidAmount: true, status: true, dueDate: true } } },
      },
    },
  });
  if (!u) notFound();

  const current = u.contracts.find((c) => ACTIVE_CONTRACT.includes(c.status)) ?? null;
  const previous = u.contracts.filter((c) => c.id !== current?.id);
  const overdue = u.contracts.flatMap((c) => c.installments).filter((i) => ["OVERDUE", "PARTIALLY_PAID"].includes(i.status)).reduce((s, i) => s + i.amount - i.paidAmount, 0);
  const currentPaid = current ? current.installments.reduce((s, i) => s + i.paidAmount, 0) : 0;
  const currentDue = current ? current.installments.filter((i) => i.status !== "WAIVED").reduce((s, i) => s + i.amount, 0) : 0;
  const docsCount = await db.document.count({ where: { organizationId: org, entityType: "UNIT", entityId: id } });
  const toEnd = current ? daysFromToday(current.endDate) : null;
  const statusOptions = Object.entries(UNIT_STATUS)
    .filter(([k]) => k !== "ARCHIVED" && k !== u.status && (k !== "RENTED" || current) && !(current && ["VACANT", "AVAILABLE"].includes(k)))
    .map(([value, v]) => ({ value, label: v.label }));
  const label = `${u.property.name} — ${u.number}`;

  return (
    <>
      <HeroHeader
        title={
          <span>
            الوحدة <span className="latin">{u.number}</span>
          </span>
        }
        code={u.code}
        status={
          <>
            <StatusTag value={u.status} map={UNIT_STATUS} />
            {tagsToArray(u.tags).map((t) => (
              <Tag key={t} tone="brand" plain>
                {t}
              </Tag>
            ))}
          </>
        }
        meta={[
          <span key="type">{UNIT_TYPES[u.type] ?? u.type} · {UNIT_USAGE[u.usage] ?? u.usage}</span>,
          <span key="prop">
            <Link href={`/properties/${u.property.id}`} className="link">{u.property.name}</Link>
            {u.property.city ? ` — ${u.property.city}` : ""}
          </span>,
          current && (
            <span key="tenant">
              المستأجر: <Link href={`/tenants/${current.tenant.id}`} className="link">{current.tenant.name}</Link>
            </span>
          ),
        ]}
        breadcrumbs={[{ label: "الوحدات", href: "/units" }, { label: u.property.name, href: `/properties/${u.property.id}` }, { label: u.number }]}
        actions={
          <>
            {!current && can(user, "contracts.manage") && u.status !== "ARCHIVED" && (
              <Link href={`/contracts/new?unitId=${u.id}&propertyId=${u.property.id}`} className="btn btn-outline btn-sm">
                عقد جديد
              </Link>
            )}
            {can(user, "units.manage") && u.status !== "ARCHIVED" && (
              <Link href={`/units/${u.id}/edit`} className="btn btn-primary btn-sm">
                تعديل
              </Link>
            )}
            <MoreMenu
              items={[
                can(user, "tasks.manage") && { label: "مهمة جديدة", href: `/tasks/new?entityType=UNIT&entityId=${u.id}&entityLabel=${encodeURIComponent(label)}` },
                ...(can(user, "units.manage") && u.status !== "ARCHIVED"
                  ? statusOptions.map((s) => ({
                      label: s.label,
                      node: (
                        <ActionButton action={setUnitStatus} hidden={{ id: u.id, status: s.value }} className="btn btn-ghost btn-sm">
                          تعيين الحالة: {s.label}
                        </ActionButton>
                      ),
                    }))
                  : []),
                can(user, "units.manage") &&
                  (u.status === "ARCHIVED"
                    ? { label: "استعادة", node: <ActionButton action={restoreUnit} hidden={{ id: u.id }} className="btn btn-ghost btn-sm">استعادة الوحدة</ActionButton> }
                    : { label: "أرشفة", danger: true, node: <ActionButton action={archiveUnit} hidden={{ id: u.id }} className="btn btn-ghost btn-sm text-danger" confirm="أرشفة الوحدة؟ لن تظهر في القوائم ولا يمكن التعاقد عليها حتى استعادتها.">أرشفة الوحدة</ActionButton> }),
              ]}
            />
          </>
        }
      />

      <StatGrid cols={4}>
        <StatCard label="الإيجار الحالي (سنوي)" value={money(u.currentRent)} sub={u.targetRent ? <span>المستهدف: <span className="num">{money(u.targetRent)}</span></span> : undefined} />
        <StatCard label="العقد الحالي" value={current ? <span className="latin">{current.code}</span> : "—"} sub={current ? `ينتهي ${date(current.endDate)}` : "لا يوجد عقد نشط"} href={current ? `/contracts/${current.id}` : undefined} tone={toEnd !== null && toEnd <= 30 ? "warning" : undefined} />
        <StatCard label="المتأخرات" value={money(overdue)} tone={overdue > 0 ? "danger" : undefined} href={`/units/${u.id}?tab=installments`} />
        <StatCard label="المستندات" value={num(docsCount)} href={`/units/${u.id}?tab=documents`} />
      </StatGrid>

      <div className="mt-4">
        <Tabs tabs={TABS.map((t) => (t.key === "contracts" ? { ...t, count: u.contracts.length } : t.key === "documents" ? { ...t, count: docsCount } : t))} active={tab} base={`/units/${u.id}`} sticky />
      </div>

      {tab === "overview" && (
        <div className="grid gap-4 xl:grid-cols-3">
          <div className="space-y-4 xl:col-span-2">
            <Card title="المستأجر والعقد الحالي" tone={current ? "warm" : "light"} actions={current ? <Link href={`/contracts/${current.id}`} className="link text-xs">فتح العقد</Link> : undefined}>
              {current ? (
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <div className="eyebrow mb-1">المستأجر</div>
                    <Link href={`/tenants/${current.tenant.id}`} className="text-lg font-bold hover:text-brand">
                      {current.tenant.name}
                    </Link>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[13px] text-muted">
                      <span className="num">{current.tenant.phone ? displayPhone(current.tenant.phone) : "—"}</span>
                      <StatusTag value={current.tenant.riskLevel} map={RISK_LEVELS} />
                    </div>
                  </div>
                  <div>
                    <div className="eyebrow mb-1">العقد</div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/contracts/${current.id}`} className="latin text-lg font-bold hover:text-brand">
                        {current.code}
                      </Link>
                      <StatusTag value={current.status} map={CONTRACT_STATUS} />
                    </div>
                    <div className="mt-1 text-[13px] text-muted">
                      {date(current.startDate)} → {date(current.endDate)}
                      {toEnd !== null && <span className={toEnd <= 30 ? "text-danger" : ""}> · {toEnd >= 0 ? `يتبقى ${toEnd} يوم` : `انتهى قبل ${-toEnd} يوم`}</span>}
                    </div>
                  </div>
                  <div className="md:col-span-2 grid grid-cols-2 gap-3 md:grid-cols-4">
                    <Mini label="قيمة العقد" v={money(current.totalAmount)} />
                    <Mini label="الدورية" v={PAYMENT_FREQUENCY[current.paymentFrequency] ?? current.paymentFrequency} />
                    <Mini label="المحصل" v={money(currentPaid)} tone="text-success" />
                    <Mini label="المتبقي" v={money(currentDue - currentPaid)} tone={currentDue - currentPaid > 0 ? "text-warning" : ""} />
                  </div>
                </div>
              ) : (
                <EmptyState
                  title="لا يوجد عقد نشط على هذه الوحدة"
                  description={u.status === "ARCHIVED" ? "الوحدة مؤرشفة." : "أنشئ عقدًا جديدًا لتأجير الوحدة."}
                  action={can(user, "contracts.manage") && u.status !== "ARCHIVED" ? <Link href={`/contracts/new?unitId=${u.id}&propertyId=${u.property.id}`} className="btn btn-primary btn-sm">عقد جديد</Link> : undefined}
                />
              )}
            </Card>

            <Card title="بيانات الوحدة">
              <DL
                cols={3}
                items={[
                  { label: "الدور", value: u.floor },
                  { label: "المساحة", value: u.area ? `${num(u.area)} م²` : null },
                  { label: "الغرف", value: u.rooms },
                  { label: "دورات المياه", value: u.bathrooms },
                  { label: "الموقع", value: [u.property.city, u.property.district].filter(Boolean).join(" — ") },
                  { label: "آخر تحديث", value: date(u.updatedAt) },
                ]}
              />
              {u.notes && <p className="mt-4 rounded-xl bg-mist px-4 py-3 text-[13px] text-text-2">{u.notes}</p>}
            </Card>
          </div>

          <div className="space-y-4">
            <Card title="المالك">
              {u.property.ownerships.length === 0 ? (
                <p className="text-[13px] text-muted">لم يُسجَّل مالك لهذا العقار.</p>
              ) : (
                u.property.ownerships.map((o) => (
                  <div key={o.id} className="flex items-center justify-between border-b border-[#EDF1EF] py-2 last:border-0">
                    <Link href={`/owners/${o.owner.id}`} className="font-bold hover:text-brand">
                      {o.owner.name}
                    </Link>
                    <b className="num text-brand">{o.percentage}%</b>
                  </div>
                ))
              )}
            </Card>
            <Card title="مؤشرات سريعة">
              <KV k="عدد العقود" v={<span className="num">{u.contracts.length}</span>} />
              <KV k="المتأخرات" v={<span className={`num ${overdue > 0 ? "text-danger" : ""}`}>{money(overdue)}</span>} />
              <KV k="المستندات" v={<span className="num">{docsCount}</span>} />
            </Card>
          </div>
        </div>
      )}

      {tab === "contracts" && (
        <div className="space-y-4">
          <ContractsTable title="العقد الحالي" rows={current ? [current] : []} empty="لا يوجد عقد نشط" />
          <ContractsTable title={`العقود السابقة (${previous.length})`} rows={previous} empty="لا توجد عقود سابقة" />
        </div>
      )}
      {tab === "installments" && <InstallmentsTab unitId={u.id} propertyId={u.propertyId} />}
      {tab === "payments" && <PaymentsTab unitId={u.id} />}
      {tab === "documents" && <DocumentsTab unitId={u.id} label={label} canManage={can(user, "documents.manage")} />}
      {tab === "activity" && <ActivityTab unitId={u.id} />}
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
  tenant: { id: string; name: string };
  installments: { amount: number; paidAmount: number; status: string }[];
};

function ContractsTable({ title, rows, empty }: { title: string; rows: ContractRow[]; empty: string }) {
  return (
    <Card padded={false} title={title}>
      {rows.length === 0 ? (
        <EmptyState title={empty} />
      ) : (
        <Table>
          <thead>
            <tr>
              <th>العقد</th>
              <th>المستأجر</th>
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
                    <Link href={`/tenants/${c.tenant.id}`} className="hover:text-brand">
                      {c.tenant.name}
                    </Link>
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
      )}
    </Card>
  );
}

async function InstallmentsTab({ unitId, propertyId }: { unitId: string; propertyId: string }) {
  const rows = await db.installment.findMany({
    where: { contract: { unitId } },
    orderBy: [{ dueDate: "desc" }],
    take: 100,
    include: { tenant: { select: { id: true, name: true } }, contract: { select: { id: true, code: true } }, collectionCase: { select: { id: true, followUpStatus: true } } },
  });
  const open = rows.filter((i) => !["PAID", "WAIVED"].includes(i.status));
  const overdueAmt = rows.filter((i) => ["OVERDUE", "PARTIALLY_PAID"].includes(i.status)).reduce((s, i) => s + i.amount - i.paidAmount, 0);
  return (
    <Card padded={false} title={`الأقساط (${rows.length})`} subtitle={`مفتوحة: ${open.length} · متأخر: ${money(overdueAmt)} ر.س`} actions={<Link href={`/properties/${propertyId}?tab=collections`} className="link text-xs">تحصيل العقار</Link>}>
      {rows.length === 0 ? (
        <EmptyState title="لا توجد أقساط" description="تُنشأ الأقساط تلقائيًا عند إنشاء عقد على الوحدة." />
      ) : (
        <Table>
          <thead>
            <tr>
              <th>العقد</th>
              <th className="num">#</th>
              <th>المستأجر</th>
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
                  <td>
                    <Link href={`/tenants/${i.tenant.id}`} className="hover:text-brand">
                      {i.tenant.name}
                    </Link>
                  </td>
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
                      <Link href={`/collections/${i.collectionCase.id}`} className="link text-xs">
                        فتح المطالبة
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

async function PaymentsTab({ unitId }: { unitId: string }) {
  const rows = await db.payment.findMany({
    where: { contract: { unitId } },
    orderBy: { paidAt: "desc" },
    take: 100,
    include: { tenant: { select: { id: true, name: true } }, contract: { select: { id: true, code: true } }, allocations: { select: { amount: true } } },
  });
  const total = rows.filter((p) => ["RECORDED", "APPROVED"].includes(p.status)).reduce((s, p) => s + p.amount, 0);
  return (
    <Card padded={false} title={`سندات القبض (${rows.length})`} subtitle={`إجمالي المسجل/المعتمد: ${money(total)} ر.س`}>
      {rows.length === 0 ? (
        <EmptyState title="لا توجد مدفوعات" />
      ) : (
        <Table>
          <thead>
            <tr>
              <th>الدفعة</th>
              <th>التاريخ</th>
              <th>المستأجر</th>
              <th>العقد</th>
              <th>الطريقة</th>
              <th className="num">المبلغ</th>
              <th className="num">المخصص</th>
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
                <td>
                  <Link href={`/tenants/${p.tenant.id}`} className="hover:text-brand">
                    {p.tenant.name}
                  </Link>
                </td>
                <td className="latin">{p.contract ? <Link href={`/contracts/${p.contract.id}`} className="hover:text-brand">{p.contract.code}</Link> : "—"}</td>
                <td>{PAYMENT_METHODS[p.method] ?? p.method}</td>
                <td className="num font-semibold">{money(p.amount)}</td>
                <td className="num">{money(p.allocations.reduce((s, a) => s + a.amount, 0))}</td>
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

async function DocumentsTab({ unitId, label, canManage }: { unitId: string; label: string; canManage: boolean }) {
  const rows = await db.document.findMany({ where: { entityType: "UNIT", entityId: unitId }, orderBy: { createdAt: "desc" } });
  const newHref = `/documents/new?entityType=UNIT&entityId=${unitId}&entityLabel=${encodeURIComponent(label)}`;
  return (
    <Card padded={false} title="المستندات" actions={canManage ? <Link href={newHref} className="btn btn-primary btn-sm">+ مستند</Link> : undefined}>
      {rows.length === 0 ? (
        <EmptyState title="لا توجد مستندات" description="ارفع صور الوحدة، محاضر التسليم، والوثائق المرتبطة." action={canManage ? <Link href={newHref} className="btn btn-outline btn-sm">رفع مستند</Link> : undefined} />
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

async function ActivityTab({ unitId }: { unitId: string }) {
  const contractIds = (await db.contract.findMany({ where: { unitId }, select: { id: true } })).map((c) => c.id);
  const rows = await db.auditLog.findMany({
    where: { OR: [{ entityType: "UNIT", entityId: unitId }, ...(contractIds.length ? [{ entityType: "CONTRACT", entityId: { in: contractIds } }] : [])] },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
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

function Mini({ label, v, tone = "" }: { label: string; v: string; tone?: string }) {
  return (
    <div className="rounded-xl bg-white/70 px-3 py-2.5">
      <div className="text-[11.5px] text-muted">{label}</div>
      <div className={`num text-base font-bold ${tone}`}>{v}</div>
    </div>
  );
}
