import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { can, contractScope } from "@/lib/permissions";
import { INSTALLMENT_STATUS, PAYMENT_STATUS, PAYMENT_METHODS, COLLECTION_STATUS, CONTRACT_STATUS, AUDIT_ACTIONS } from "@/lib/constants";
import { money, date, datetime, daysOverdue, daysFromToday, pct } from "@/lib/format";
import { PageHeader, Card, Table, StatusTag, DL, StatGrid, StatCard, Progress, EmptyState, KV, Field, Input, PriorityPill } from "@/components/ui";
import { waiveInstallment } from "../actions";
import { displayPhone, telHref } from "@/lib/phone";

export const dynamic = "force-dynamic";

export default async function InstallmentPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireStaff();
  const { id } = await params;
  const org = user.organizationId;
  const inst = await db.installment.findFirst({
    where: { id, organizationId: org, ...contractScope(user) },
    include: {
      tenant: { select: { id: true, name: true, phone: true, riskLevel: true } },
      contract: { select: { id: true, code: true, status: true, endDate: true, paymentFrequency: true, unit: { select: { id: true, number: true } }, property: { select: { id: true, name: true } } } },
      allocations: { orderBy: { createdAt: "desc" }, include: { payment: { select: { id: true, code: true, paidAt: true, amount: true, method: true, status: true, reference: true } } } },
      collectionCase: { include: { collector: { select: { name: true } }, actions: { orderBy: { createdAt: "desc" }, take: 5 } } },
    },
  });
  if (!inst) notFound();

  const [siblings, waivedBy, activity] = await Promise.all([
    db.installment.findMany({ where: { contractId: inst.contractId }, orderBy: { seq: "asc" }, select: { id: true, seq: true, dueDate: true, amount: true, paidAmount: true, status: true } }),
    inst.waivedById ? db.user.findUnique({ where: { id: inst.waivedById }, select: { name: true } }) : Promise.resolve(null),
    db.auditLog.findMany({ where: { entityType: "INSTALLMENT", entityId: id }, orderBy: { createdAt: "desc" }, take: 20 }),
  ]);

  const remaining = inst.status === "WAIVED" ? 0 : inst.amount - inst.paidAmount;
  const closed = ["PAID", "WAIVED"].includes(inst.status);
  const late = closed ? 0 : daysOverdue(inst.dueDate);
  const ahead = daysFromToday(inst.dueDate);
  const paidPct = inst.amount ? (inst.paidAmount / inst.amount) * 100 : 0;
  const label = `${inst.contract.code} / ${inst.seq}`;

  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            القسط <span className="latin">{label}</span> <StatusTag value={inst.status} map={INSTALLMENT_STATUS} />
          </span>
        }
        subtitle={
          <span>
            {inst.tenant.name} · الوحدة <span className="latin">{inst.contract.unit.number}</span> — {inst.contract.property.name} · يستحق {date(inst.dueDate)}
            {late > 0 && <b className="mr-2 text-danger">متأخر {late} يوم</b>}
            {!closed && late === 0 && ahead >= 0 && <span className="mr-2 text-muted">({ahead === 0 ? "اليوم" : `بعد ${ahead} يوم`})</span>}
          </span>
        }
        breadcrumbs={[{ label: "جدول الدفعات", href: "/installments" }, { label: inst.contract.code, href: `/contracts/${inst.contract.id}?tab=installments` }, { label: `قسط ${inst.seq}` }]}
        actions={
          <>
            {inst.collectionCase && (
              <Link href={`/collections/${inst.collectionCase.id}`} className="btn btn-outline btn-sm">
                المطالبة
              </Link>
            )}
            {can(user, "payments.manage") && remaining > 0 && (
              <Link href={`/payments/new?installmentId=${inst.id}&tenantId=${inst.tenant.id}`} className="btn btn-primary btn-sm">
                تسجيل دفعة
              </Link>
            )}
          </>
        }
      />

      <StatGrid cols={4}>
        <StatCard label="مبلغ القسط" value={money(inst.amount, { decimals: true })} />
        <StatCard label="المدفوع" value={money(inst.paidAmount, { decimals: true })} tone="success" sub={<Progress value={paidPct} />} />
        <StatCard label="المتبقي" value={money(remaining, { decimals: true })} tone={remaining > 0 && late > 0 ? "danger" : undefined} />
        <StatCard label="نسبة السداد" value={pct(paidPct)} dark />
      </StatGrid>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card title="تفاصيل القسط">
            <DL
              cols={3}
              items={[
                { label: "العقد", value: <Link href={`/contracts/${inst.contract.id}`} className="link latin">{inst.contract.code}</Link> },
                { label: "حالة العقد", value: <StatusTag value={inst.contract.status} map={CONTRACT_STATUS} /> },
                { label: "المستأجر", value: <Link href={`/tenants/${inst.tenant.id}`} className="link">{inst.tenant.name}</Link> },
                { label: "الجوال", value: inst.tenant.phone ? <a href={telHref(inst.tenant.phone)} className="link num">{displayPhone(inst.tenant.phone)}</a> : null },
                { label: "الوحدة", value: <Link href={`/units/${inst.contract.unit.id}`} className="link latin">{inst.contract.unit.number}</Link> },
                { label: "العقار", value: <Link href={`/properties/${inst.contract.property.id}`} className="link">{inst.contract.property.name}</Link> },
                { label: "تاريخ الاستحقاق", value: date(inst.dueDate) },
                { label: "الترتيب", value: <span className="num">{inst.seq} من {siblings.length}</span> },
                { label: "آخر تحديث", value: datetime(inst.updatedAt) },
                ...(inst.status === "WAIVED" ? [{ label: "سبب الإعفاء", value: inst.waivedReason }, { label: "أعفاه", value: waivedBy?.name }] : []),
              ]}
            />
          </Card>

          <Card padded={false} title={`سندات القبض المخصصة (${inst.allocations.length})`}>
            {inst.allocations.length === 0 ? (
              <EmptyState title="لا توجد دفعات مخصصة لهذا القسط" action={can(user, "payments.manage") && remaining > 0 ? <Link href={`/payments/new?installmentId=${inst.id}&tenantId=${inst.tenant.id}`} className="btn btn-primary btn-sm">تسجيل دفعة</Link> : undefined} />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <th>الدفعة</th>
                    <th>التاريخ</th>
                    <th className="num">المخصص للقسط</th>
                    <th className="num">إجمالي الدفعة</th>
                    <th>الطريقة</th>
                    <th>المرجع</th>
                    <th>الحالة</th>
                  </tr>
                </thead>
                <tbody>
                  {inst.allocations.map((a) => (
                    <tr key={a.id}>
                      <td>
                        <Link href={`/payments/${a.payment.id}`} className="cell-primary latin hover:text-brand">
                          {a.payment.code}
                        </Link>
                      </td>
                      <td>{date(a.payment.paidAt)}</td>
                      <td className="num font-semibold">{money(a.amount, { decimals: true })}</td>
                      <td className="num text-muted">{money(a.payment.amount, { decimals: true })}</td>
                      <td>{PAYMENT_METHODS[a.payment.method] ?? a.payment.method}</td>
                      <td className="latin text-muted">{a.payment.reference ?? "—"}</td>
                      <td>
                        <StatusTag value={a.payment.status} map={PAYMENT_STATUS} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>

          <Card padded={false} title="جدول أقساط العقد">
            <Table>
              <thead>
                <tr>
                  <th className="num">#</th>
                  <th>الاستحقاق</th>
                  <th className="num">المبلغ</th>
                  <th className="num">المدفوع</th>
                  <th>الحالة</th>
                </tr>
              </thead>
              <tbody>
                {siblings.map((s) => (
                  <tr key={s.id} className={s.id === inst.id ? "bg-sand-75" : ""}>
                    <td className="num">{s.id === inst.id ? <b>{s.seq}</b> : <Link href={`/installments/${s.id}`} className="hover:text-brand">{s.seq}</Link>}</td>
                    <td>{date(s.dueDate)}</td>
                    <td className="num">{money(s.amount)}</td>
                    <td className="num">{money(s.paidAmount)}</td>
                    <td>
                      <StatusTag value={s.status} map={INSTALLMENT_STATUS} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="المطالبة">
            {inst.collectionCase ? (
              <>
                <div className="mb-2 flex items-center justify-between">
                  <StatusTag value={inst.collectionCase.followUpStatus} map={COLLECTION_STATUS} />
                  <PriorityPill v={inst.collectionCase.priority} />
                </div>
                <KV k="المحصل" v={inst.collectionCase.collector?.name ?? "—"} />
                <KV k="وعد بالسداد" v={inst.collectionCase.promiseDate ? `${money(inst.collectionCase.promiseAmount)} · ${date(inst.collectionCase.promiseDate)}` : "—"} />
                <KV k="وعود مكسورة" v={<span className="num">{inst.collectionCase.brokenPromises}</span>} />
                <KV k="آخر إجراء" v={inst.collectionCase.lastActionAt ? datetime(inst.collectionCase.lastActionAt) : "—"} />
                {inst.collectionCase.actions.length > 0 && (
                  <div className="timeline mt-3">
                    {inst.collectionCase.actions.map((a) => (
                      <div key={a.id} className="timeline-item">
                        <div className="text-[12.5px]">{a.note ?? a.type}</div>
                        <div className="text-[11px] text-faint">{datetime(a.createdAt)}</div>
                      </div>
                    ))}
                  </div>
                )}
                <Link href={`/collections/${inst.collectionCase.id}`} className="btn btn-outline btn-sm mt-3 w-full">
                  فتح المطالبة
                </Link>
              </>
            ) : (
              <p className="text-[13px] text-muted">{closed ? "لا توجد مطالبة — القسط مغلق." : "تُفتح المطالبة تلقائيًا عند تجاوز تاريخ الاستحقاق."}</p>
            )}
          </Card>

          {can(user, "installments.waive") && !closed && (
            <Card title="إعفاء من القسط" subtitle="يُغلق القسط والمطالبة ويُسجل في سجل العمليات">
              <form action={waiveInstallment} className="space-y-3">
                <input type="hidden" name="id" value={inst.id} />
                <Field label="سبب الإعفاء" name="reason" required>
                  <Input name="reason" required placeholder="مثال: تعويض عن أعمال صيانة" />
                </Field>
                <p className="text-[12.5px] text-muted">
                  سيُعفى المتبقي <b className="num">{money(remaining)}</b> ر.س.
                </p>
                <button type="submit" className="btn btn-danger-soft btn-sm">
                  إعفاء القسط
                </button>
              </form>
            </Card>
          )}

          <Card title="سجل العمليات">
            {activity.length === 0 ? (
              <p className="text-[13px] text-muted">لا توجد عمليات مسجلة.</p>
            ) : (
              <div className="timeline">
                {activity.map((a) => (
                  <div key={a.id} className="timeline-item">
                    <div className="text-[13px]">
                      <StatusTag value={a.action} map={AUDIT_ACTIONS} /> <b>{a.userName}</b>
                    </div>
                    <div className="text-[11.5px] text-faint">{datetime(a.createdAt)}</div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
