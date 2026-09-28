import Link from "next/link";
import { requireTenant } from "@/lib/auth";
import { db } from "@/lib/db";
import { money, date, relative, daysFromToday, daysOverdue, datetime, num } from "@/lib/format";
import { INSTALLMENT_STATUS, UNIT_TYPES } from "@/lib/constants";
import { Card, StatusTag, EmptyState, Alert, ActionButton, Progress, Tag } from "@/components/ui";
import { LogoMark } from "@/components/Logo";
import { GuideCard } from "@/components/GuideCard";
import { getTenantContract, ACTIVE_CONTRACT_STATUSES } from "./_scope";

export const dynamic = "force-dynamic";

export default async function TenantDashboard() {
  const user = await requireTenant();
  const org = user.organizationId;
  const contract = await getTenantContract(user);

  const [tenant, orgRow, allInstallments, notifications] = await Promise.all([
    db.tenant.findFirst({ where: { id: user.tenantId, organizationId: org }, select: { name: true } }),
    db.organization.findUnique({ where: { id: org }, select: { name: true, phone: true } }),
    db.installment.findMany({ where: { organizationId: org, tenantId: user.tenantId, status: { not: "WAIVED" }, contract: { status: { notIn: ["DRAFT", "CANCELLED"] } } }, orderBy: { dueDate: "asc" }, select: { id: true, amount: true, paidAmount: true, dueDate: true, status: true, seq: true } }),
    db.notification.findMany({ where: { userId: user.id, organizationId: org }, orderBy: { createdAt: "desc" }, take: 3 }),
  ]);

  const total = allInstallments.reduce((s, i) => s + i.amount, 0);
  const paid = allInstallments.reduce((s, i) => s + i.paidAmount, 0);
  const remaining = total - paid;
  const overdue = allInstallments.filter((i) => ["OVERDUE", "PARTIALLY_PAID"].includes(i.status) && daysOverdue(i.dueDate) > 0).reduce((s, i) => s + (i.amount - i.paidAmount), 0);
  const next = allInstallments.find((i) => !["PAID", "WAIVED"].includes(i.status));
  const isActive = contract ? ACTIVE_CONTRACT_STATUSES.includes(contract.status) : false;
  const firstName = (tenant?.name ?? user.name).split(" ")[0];
  const nextLate = next ? daysOverdue(next.dueDate) : 0;
  const nextLeft = next ? daysFromToday(next.dueDate) : 0;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex items-center gap-3">
        <LogoMark size={36} />
        <div className="leading-tight">
          <h1 className="text-[20px] font-bold text-ink">أهلًا، {firstName}</h1>
          <div className="text-[12.5px] text-muted">{orgRow?.name} · {date(new Date())}</div>
        </div>
      </div>

      <GuideCard
        id="tenant.welcome"
        title={`أهلًا بك في بوابة المستأجر${orgRow?.name ? ` لدى ${orgRow.name}` : ""}`}
        steps={[
          "هنا ترى عقدك ودفعاتك القادمة وتاريخ استحقاق كل دفعة.",
          "بعد كل سداد يظهر سند القبض هنا ويتحدث رصيدك تلقائيًا.",
          "المستندات المشتركة معك والتذكيرات تصلك في هذه البوابة.",
        ]}
        note={orgRow?.phone ? `للاستفسار أو تصحيح بيانات تواصل مع المكتب على ${orgRow.phone}.` : "للاستفسار أو تصحيح بيانات تواصل مع المكتب مباشرة."}
        cta={{ href: "/tenant/payments", label: "دفعاتي" }}
        secondary={{ href: "/tenant/contract", label: "عقدي" }}
      />

      {overdue > 0 && (
        <div className="mb-4">
          <Alert tone="danger" title="لديك دفعة متأخرة">
            المبلغ المتأخر <b className="num">{money(overdue)}</b> ر.س. يرجى السداد في أقرب وقت أو التواصل مع المكتب{orgRow?.phone ? ` على ${orgRow.phone}` : ""}.
          </Alert>
        </div>
      )}

      {/* Hero: unit + next payment + two big actions */}
      <section className="card-dark p-5 md:p-6">
        {!contract ? (
          <p className="text-[13.5px] text-[#C6D2CE]">لا يوجد عقد مرتبط بحسابك حاليًا. تواصل مع المكتب لربطه.</p>
        ) : (
          <div>
            <div className="text-[13px] text-[#BCCBC5]">
              الوحدة <b className="text-white">{contract.unit.number}</b> · {UNIT_TYPES[contract.unit.type] ?? contract.unit.type}
            </div>
            <div className="mt-0.5 text-[20px] font-bold text-white">{contract.property.name}</div>
            {isActive && <div className="num mt-1 text-[12px] text-[#8FA099]">العقد ساري حتى {date(contract.endDate)}</div>}
          </div>
        )}

        <div className="mt-5 border-t border-white/10 pt-5">
          <div className="text-[13px] font-semibold text-[#BCCBC5]">الدفعة القادمة</div>
          {!next ? (
            <div className="mt-1 text-[15px] font-bold text-sand-200">لا توجد دفعات مستحقة. جميع دفعاتك مسددة.</div>
          ) : (
            <>
              <div className={`num mt-1 text-[36px] font-extrabold leading-none md:text-[42px] ${next.status === "OVERDUE" ? "text-[#F3B3AE]" : "text-sand-200"}`}>
                {money(next.amount - next.paidAmount)} <span className="text-[15px] font-semibold text-[#BCCBC5]">ر.س</span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-[#C6D2CE]">
                <span className="num">تستحق {date(next.dueDate)}</span>
                <span className={`num font-bold ${next.status === "OVERDUE" ? "text-[#F3B3AE]" : "text-white"}`}>
                  {next.status === "OVERDUE" ? `متأخرة ${num(nextLate)} يوم` : nextLate > 0 ? "ضمن مهلة السداد" : nextLeft === 0 ? "تستحق اليوم" : `متبقٍ ${num(nextLeft)} يوم`}
                </span>
                <StatusTag value={next.status} map={INSTALLMENT_STATUS} />
              </div>
            </>
          )}
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <Link href="/tenant/payments" className="btn btn-accent min-h-[48px] w-full text-[15px]">
              {next ? "طريقة السداد" : "الدفعات"}
            </Link>
        </div>
      </section>

      {/* Balance line */}
      <Card className="mt-4">
        <div className="flex flex-wrap items-center justify-between gap-2 text-[13.5px]">
          <span>
            المسدد <b className="num text-success">{money(paid)}</b> ر.س
          </span>
          <span>
            المتبقي <b className="num text-text">{money(remaining)}</b> ر.س
          </span>
        </div>
        <div className="mt-2">
          <Progress value={total ? (paid / total) * 100 : 0} />
        </div>
        <div className="mt-2 flex items-center justify-between text-[12px] text-muted">
          <span>إجمالي أقساط العقد {money(total)} ر.س</span>
          <Link href="/tenant/payments" className="link">كل الدفعات</Link>
        </div>
      </Card>

      {/* Last 3 notifications */}
      <Card title="آخر الإشعارات" actions={<Link href="/tenant/notifications" className="link text-xs">الكل</Link>} className="mt-4" padded={false}>
        {notifications.length === 0 ? (
          <EmptyState title="لا توجد إشعارات" description="ستصلك هنا تذكيرات الدفعات وتحديثات العقد." />
        ) : (
          <ul className="divide-y divide-line">
            {notifications.map((n) => {
              const href = n.href && n.href.startsWith("/tenant") ? n.href : "/tenant/notifications";
              return (
                <li key={n.id}>
                  <Link href={href} className="flex min-h-[48px] items-center gap-3 px-5 py-3 hover:bg-mist">
                    <span className={`h-2 w-2 flex-none rounded-full ${n.readAt ? "bg-line" : "bg-brand"}`} aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px] font-semibold text-text">{n.title}</span>
                      <span className="num block text-[11.5px] text-muted">{relative(n.createdAt)} · {datetime(n.createdAt)}</span>
                    </span>
                    {n.severity === "DANGER" && <Tag tone="danger" plain>هام</Tag>}
                    {n.severity === "WARNING" && <Tag tone="warning" plain>تنبيه</Tag>}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
