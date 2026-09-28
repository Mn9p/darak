import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { can, contractScope } from "@/lib/permissions";
import { COLLECTION_STATUS, COLLECTION_ACTION_TYPES, COLLECTION_OUTCOMES, INSTALLMENT_STATUS, PAYMENT_STATUS, RISK_LEVELS, NOTIFICATION_CHANNELS } from "@/lib/constants";
import { money, date, datetime, daysOverdue, daysFromToday, relative, inputDate } from "@/lib/format";
import { PageHeader, Card, Table, StatusTag, StatGrid, StatCard, DL, EmptyState, Tag, PriorityPill, Progress, ActionButton } from "@/components/ui";
import { MoreMenu, Optional } from "@/components/MoreMenu";
import { CaseActions } from "./CaseActions";
import { sendTemplate, renderTemplate } from "../actions";
import { displayPhone, telHref } from "@/lib/phone";

export const dynamic = "force-dynamic";

export default async function CollectionCasePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireStaff();
  const { id } = await params;
  const org = user.organizationId;

  const k = await db.collectionCase.findFirst({
    where: { id, organizationId: org, installment: { ...contractScope(user) } },
    include: {
      installment: {
        include: {
          tenant: { select: { id: true, name: true, phone: true, email: true, riskLevel: true, code: true } },
          contract: {
            select: {
              id: true,
              code: true,
              endDate: true,
              status: true,
              unit: { select: { id: true, number: true } },
              property: { select: { id: true, name: true } },
            },
          },
          allocations: { include: { payment: { select: { id: true, code: true, paidAt: true, status: true, method: true } } }, orderBy: { createdAt: "desc" } },
        },
      },
      collector: { select: { id: true, name: true } },
      actions: { orderBy: { createdAt: "desc" }, include: { byUser: { select: { name: true } } } },
    },
  });
  if (!k) notFound();

  const inst = k.installment;
  const remaining = inst.amount - inst.paidAmount;
  const late = daysOverdue(inst.dueDate);
  const daysSince = k.lastActionAt ? -daysFromToday(k.lastActionAt) : null;
  const contractEnds = daysFromToday(inst.contract.endDate);
  const canManage = can(user, "collections.manage");
  const canRecordPayment = can(user, "payments.manage");
  const newPaymentHref = `/payments/new?installmentId=${inst.id}&tenantId=${inst.tenant.id}`;

  // Explain the priority score (mirrors scorePriority in engine.ts).
  const reasons = [
    { label: "المبلغ المتبقي", pts: Math.min(30, remaining / 2000), max: 30, detail: `${money(remaining)} ر.س` },
    { label: "أيام التأخر", pts: Math.min(30, late * 0.5), max: 30, detail: `${late} يوم` },
    { label: "وعود مكسورة", pts: Math.min(15, k.brokenPromises * 7), max: 15, detail: `${k.brokenPromises}` },
    { label: "بدون تواصل حديث", pts: daysSince === null ? 10 : Math.min(10, daysSince), max: 10, detail: daysSince === null ? "لم يتم التواصل" : `آخر إجراء قبل ${daysSince} يوم` },
    { label: "قرب انتهاء العقد", pts: contractEnds <= 30 ? 10 : 0, max: 10, detail: contractEnds < 0 ? "العقد منتهٍ" : `ينتهي بعد ${contractEnds} يوم` },
    { label: "مخاطر المستأجر", pts: inst.tenant.riskLevel === "HIGH" ? 5 : inst.tenant.riskLevel === "MEDIUM" ? 2 : 0, max: 5, detail: RISK_LEVELS[inst.tenant.riskLevel]?.label ?? inst.tenant.riskLevel },
  ];

  const [collectors, templates] = await Promise.all([
    db.user.findMany({ where: { organizationId: org, role: { in: ["COLLECTOR", "OFFICE_MANAGER"] }, status: "ACTIVE" }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.notificationTemplate.findMany({ where: { organizationId: org, isActive: true, event: { in: ["INSTALLMENT_DUE", "INSTALLMENT_OVERDUE"] } }, orderBy: { name: "asc" } }),
  ]);
  const vars = { tenant_name: inst.tenant.name, unit_number: inst.contract.unit.number, amount: money(remaining), due_date: date(inst.dueDate) };
  const rendered = await Promise.all(templates.map(async (t) => ({ ...t, text: await renderTemplate(t.body, vars) })));

  const timelineTone = (a: (typeof k.actions)[number]) =>
    a.type === "ESCALATION" || a.outcome === "REFUSED" || a.outcome === "DISPUTED" ? "danger" : a.outcome === "NO_ANSWER" ? "warning" : a.type === "SYSTEM" ? "neutral" : "";

  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {inst.tenant.name}
            <StatusTag value={k.followUpStatus} map={COLLECTION_STATUS} />
            <PriorityPill v={k.priority} />
          </span>
        }
        subtitle={
          <span>
            الوحدة <Link href={`/units/${inst.contract.unit.id}`} className="link latin">{inst.contract.unit.number}</Link> · {inst.contract.property.name} · العقد{" "}
            <Link href={`/contracts/${inst.contract.id}`} className="link latin">{inst.contract.code}</Link> · القسط <span className="num">{inst.seq}</span>
          </span>
        }
        breadcrumbs={[{ label: "التحصيل", href: "/collections" }, { label: inst.tenant.name }]}
        actions={
          <>
            {canRecordPayment && (
              <Link href={newPaymentHref} className="btn btn-primary btn-sm">
                تسجيل دفعة
              </Link>
            )}
            <Link href={`/tenants/${inst.tenant.id}`} className="btn btn-outline btn-sm">
              ملف المستأجر
            </Link>
            <MoreMenu
              items={[
                inst.tenant.phone ? { label: `اتصال ${displayPhone(inst.tenant.phone)}`, href: telHref(inst.tenant.phone) } : null,
                { label: "صفحة القسط", href: `/installments/${inst.id}` },
                { label: "العقد", href: `/contracts/${inst.contract.id}` },
                { label: "الوحدة", href: `/units/${inst.contract.unit.id}` },
                { label: "العقار", href: `/properties/${inst.contract.property.id}` },
                { label: "دفعات المستأجر", href: `/payments?q=${encodeURIComponent(inst.tenant.name)}` },
              ]}
            />
          </>
        }
      />

      <StatGrid cols={4}>
        <StatCard label="المتبقي" value={money(remaining)} sub={`من ${money(inst.amount)} ر.س`} tone={remaining > 0 ? "danger" : "success"} />
        <StatCard label="أيام التأخر" value={money(late)} sub={`الاستحقاق ${date(inst.dueDate)}`} tone={late > 30 ? "danger" : late > 0 ? "warning" : undefined} />
        <StatCard label="وعود مكسورة" value={money(k.brokenPromises)} tone={k.brokenPromises > 0 ? "danger" : undefined} />
        <StatCard label="الأولوية" value={<span className="num">{k.priority}</span>} sub={<Progress value={k.priority} tone={k.priority >= 60 ? "danger" : k.priority >= 35 ? "warn" : undefined} />} dark />
      </StatGrid>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card title="بيانات المطالبة">
            <DL
              cols={3}
              items={[
                { label: "الجوال", value: inst.tenant.phone ? <a href={telHref(inst.tenant.phone)} className="link num">{displayPhone(inst.tenant.phone)}</a> : null },
                { label: "مستوى المخاطر", value: <StatusTag value={inst.tenant.riskLevel} map={RISK_LEVELS} /> },
                { label: "حالة القسط", value: <StatusTag value={inst.status} map={INSTALLMENT_STATUS} /> },
                { label: "انتهاء العقد", value: `${date(inst.contract.endDate)} (${relative(inst.contract.endDate)})` },
                { label: "المحصل", value: k.collector?.name ?? <Tag tone="warning" plain>غير مسندة</Tag> },
                { label: "وعد السداد", value: k.promiseDate ? `${money(k.promiseAmount)} ر.س — ${date(k.promiseDate)} (${relative(k.promiseDate)})` : null },
                { label: "الإجراء التالي", value: k.nextAction ? `${k.nextAction}${k.nextActionDate ? ` — ${relative(k.nextActionDate)}` : ""}` : null },
                { label: "آخر إجراء", value: k.lastActionAt ? datetime(k.lastActionAt) : null },
                { label: "تاريخ التصعيد", value: k.escalatedAt ? datetime(k.escalatedAt) : null },
                { label: "فُتحت المطالبة", value: datetime(k.createdAt) },
              ]}
            />
          </Card>

          <Card title="سجل المتابعة" subtitle={`${k.actions.length} إجراء`}>
            {k.actions.length === 0 ? (
              <EmptyState title="لا توجد إجراءات بعد" description="سجّل أول اتصال أو رسالة من لوحة الإجراءات." />
            ) : (
              <div className="timeline">
                {k.actions.map((a) => (
                  <div key={a.id} className={`timeline-item ${timelineTone(a)}`}>
                    <div className="flex flex-wrap items-center gap-2 text-[13px]">
                      <b>{COLLECTION_ACTION_TYPES[a.type] ?? a.type}</b>
                      {a.outcome && (
                        <Tag tone={a.outcome === "PAID" || a.outcome === "PROMISED" ? "success" : a.outcome === "NO_ANSWER" ? "warning" : a.outcome === "REFUSED" || a.outcome === "DISPUTED" ? "danger" : "info"} plain>
                          {COLLECTION_OUTCOMES[a.outcome] ?? a.outcome}
                        </Tag>
                      )}
                      <span className="text-muted">بواسطة {a.byUser?.name ?? "النظام"}</span>
                    </div>
                    {a.note && <p className="mt-0.5 whitespace-pre-line text-[13px] text-text-2">{a.note}</p>}
                    <div className="text-[11.5px] text-faint">
                      {datetime(a.createdAt)} · {relative(a.createdAt)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card title="الدفعات على هذا القسط" padded={false} actions={canRecordPayment ? <Link href={newPaymentHref} className="btn btn-outline btn-sm">تسجيل دفعة</Link> : undefined}>
            {inst.allocations.length === 0 ? (
              <EmptyState title="لا توجد دفعات" description="لم يُسدد أي مبلغ من هذا القسط حتى الآن." />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <th>الدفعة</th>
                    <th>التاريخ</th>
                    <th className="num">المبلغ المخصص</th>
                    <th>حالة الدفعة</th>
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
                      <td className={`num font-semibold ${["REVERSED", "RETURNED"].includes(a.payment.status) ? "line-through text-muted" : ""}`}>{money(a.amount)}</td>
                      <td>
                        <StatusTag value={a.payment.status} map={PAYMENT_STATUS} />
                      </td>
                    </tr>
                  ))}
                  <tr>
                    <td colSpan={2} className="font-bold">
                      المسدد / المتبقي
                    </td>
                    <td className="num font-bold" colSpan={2}>
                      {money(inst.paidAmount)} / <span className="text-danger">{money(remaining)}</span> ر.س
                    </td>
                  </tr>
                </tbody>
              </Table>
            )}
          </Card>

          <Optional title="كيف حُسبت الأولوية؟" hint={`${k.priority} من 100`}>
            <div className="grid gap-3 md:grid-cols-2">
              {reasons.map((r) => (
                <div key={r.label}>
                  <div className="mb-1 flex items-center justify-between text-[13px]">
                    <span>
                      {r.label} <span className="text-muted">— {r.detail}</span>
                    </span>
                    <b className="num">
                      {Math.round(r.pts)}/{r.max}
                    </b>
                  </div>
                  <Progress value={(r.pts / r.max) * 100} tone={r.pts / r.max >= 0.66 ? "danger" : r.pts / r.max >= 0.33 ? "warn" : undefined} />
                </div>
              ))}
            </div>
          </Optional>
        </div>

        <div className="space-y-4">
          <Card title="الإجراءات">
            <CaseActions
              caseId={k.id}
              remaining={remaining}
              followUpStatus={k.followUpStatus}
              installmentStatus={inst.status}
              collectors={collectors}
              collectorId={k.collectorId}
              nextAction={k.nextAction}
              nextActionDate={inputDate(k.nextActionDate)}
              promiseAmount={k.promiseAmount}
              promiseDate={inputDate(k.promiseDate)}
              canManage={canManage}
            />
          </Card>

          <Card title="قوالب الرسائل" subtitle="معاينة بقيم هذا المستأجر.">
            {rendered.length === 0 ? (
              <p className="text-[13px] text-muted">لا توجد قوالب نشطة للاستحقاق أو التأخر.</p>
            ) : (
              <div className="space-y-3">
                {rendered.map((t) => (
                  <div key={t.id} className="rounded-xl border border-line p-3">
                    <div className="flex items-center justify-between gap-2">
                      <b className="text-[13px]">{t.name}</b>
                      <Tag tone="info" plain>
                        {NOTIFICATION_CHANNELS[t.channel] ?? t.channel}
                      </Tag>
                    </div>
                    <p className="mt-1.5 whitespace-pre-line text-[12.5px] text-text-2">{t.text}</p>
                    {canManage && !["PAID", "CLOSED"].includes(k.followUpStatus) && (
                      <div className="mt-2">
                        <ActionButton action={sendTemplate} hidden={{ caseId: k.id, templateId: t.id }} className="btn btn-outline btn-xs">
                          إرسال
                        </ActionButton>
                      </div>
                    )}
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
