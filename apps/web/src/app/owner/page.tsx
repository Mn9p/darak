import Link from "next/link";
import { requireOwner } from "@/lib/auth";
import { db } from "@/lib/db";
import { money, pct, date, num, relative, startOfMonth, endOfMonth, addDays, monthLabel } from "@/lib/format";
import { STATEMENT_STATUS } from "@/lib/constants";
import { Card, EmptyState, StatusTag } from "@/components/ui";
import { LogoMark } from "@/components/Logo";
import { GuideCard } from "@/components/GuideCard";
import { getOwnerScope } from "./_scope";
import { getOrgSettings } from "@/lib/engine";
import { isArrears } from "@/lib/collections";

export const dynamic = "force-dynamic";

export default async function OwnerDashboard() {
  const user = await requireOwner();
  const scope = await getOwnerScope(user);
  const org = scope.org;
  const now = new Date();
  const monthStart = startOfMonth(now);
  const monthEnd = endOfMonth(now);
  const activeStatuses = ["ACTIVE", "EXPIRING_SOON", "RENEWAL_PENDING"];

  const [settings, units, monthAllocations, overdueInst, statementsDue, expiring, lastStatement, ownerRow, orgRow] = await Promise.all([
    getOrgSettings(org),
    db.unit.findMany({ where: { organizationId: org, propertyId: { in: scope.propertyIds }, status: { not: "ARCHIVED" } }, select: { id: true, number: true, status: true, targetRent: true, currentRent: true, propertyId: true, property: { select: { name: true } } } }),
    db.paymentAllocation.findMany({
      where: { payment: { organizationId: org, paidAt: { gte: monthStart, lte: monthEnd }, status: { in: ["RECORDED", "APPROVED"] } }, installment: { contract: { propertyId: { in: scope.allPropertyIds } } } },
      select: { amount: true, payment: { select: { paidAt: true } }, installment: { select: { contract: { select: { propertyId: true } } } } },
    }),
    db.installment.findMany({ where: { organizationId: org, status: { in: ["OVERDUE", "PARTIALLY_PAID"] }, contract: { propertyId: { in: scope.propertyIds } } }, select: { amount: true, paidAmount: true, dueDate: true, status: true, contract: { select: { paymentFrequency: true } } } }),
    db.ownerStatement.aggregate({ where: { organizationId: org, ownerId: scope.ownerId, status: "APPROVED" }, _sum: { netDue: true }, _count: true }),
    db.contract.findMany({
      where: { organizationId: org, propertyId: { in: scope.propertyIds }, status: { in: activeStatuses }, endDate: { lte: addDays(now, 90) } },
      orderBy: { endDate: "asc" },
      take: 5,
      select: { id: true, code: true, endDate: true, tenant: { select: { name: true } }, unit: { select: { number: true } }, property: { select: { name: true } } },
    }),
    db.ownerStatement.findFirst({ where: { organizationId: org, ownerId: scope.ownerId, status: { in: ["APPROVED", "PAID", "CLOSED"] } }, orderBy: { periodEnd: "desc" }, include: { property: { select: { name: true } } } }),
    db.owner.findFirst({ where: { id: scope.ownerId, organizationId: org }, select: { name: true } }),
    db.organization.findUnique({ where: { id: org }, select: { name: true, phone: true } }),
  ]);

  const welcome = (
    <GuideCard
      id="owner.welcome"
      title={`أهلًا بك في بوابة المالك${orgRow?.name ? ` لدى ${orgRow.name}` : ""}`}
      steps={[
        "تابع عقاراتك ووحداتك ونسبة الإشغال أولًا بأول.",
        "اطلع على كشوف حسابك وصافي المستحق لك بعد اعتمادها من المكتب.",
        "راجع المتأخرات والعقود التي تقترب من الانتهاء دون الحاجة للاتصال.",
      ]}
      note={orgRow?.phone ? `للاستفسار تواصل مع المكتب على ${orgRow.phone}.` : "للاستفسار تواصل مع المكتب مباشرة."}
      cta={{ href: "/owner/statements", label: "كشوف الحساب" }}
      secondary={{ href: "/owner/properties", label: "عقاراتي" }}
    />
  );

  const shareOf = (propertyId: string, at: Date, amount: number) => (amount * scope.pctOf(propertyId, at)) / 100;
  const totalUnits = units.length;
  const rented = units.filter((u) => u.status === "RENTED").length;
  const vacantUnits = units.filter((u) => ["VACANT", "AVAILABLE"].includes(u.status)).slice(0, 5);
  const occupancy = totalUnits ? (rented / totalUnits) * 100 : 0;
  const monthCollected = monthAllocations.reduce((s, a) => s + shareOf(a.installment.contract.propertyId, a.payment.paidAt, a.amount), 0);
  // Arrears = past the statutory grace only (a partial payment still inside grace is not late).
  const arrears = overdueInst.filter((i) => isArrears(i, settings));
  const overdueAmt = arrears.reduce((s, i) => s + (i.amount - i.paidAmount), 0);
  const netDue = statementsDue._sum.netDue ?? 0;
  const firstName = (ownerRow?.name ?? user.name).split(" ")[0];

  const attention: { title: string; sub: string; href: string; tone: "danger" | "warning" | "info" }[] = [
    ...expiring.map((c) => ({ title: `عقد ينتهي ${relative(c.endDate)}: ${c.tenant.name}`, sub: `${c.property.name} — ${c.unit.number} · ${date(c.endDate)}`, href: "/owner/contracts", tone: "warning" as const })),
    ...vacantUnits.map((u) => ({ title: `وحدة شاغرة: ${u.number}`, sub: `${u.property.name}${u.targetRent ?? u.currentRent ? ` · الإيجار المستهدف ${money(u.targetRent ?? u.currentRent)} ر.س` : ""}`, href: `/owner/properties/${u.propertyId}?tab=units`, tone: "info" as const })),
  ];

  if (scope.propertyIds.length === 0) {
    return (
      <>
        <h1 className="mb-5 text-[22px] font-bold text-ink">أهلًا، {firstName}</h1>
        {welcome}
        <Card>
          <EmptyState title="لا توجد عقارات مرتبطة بحسابك" description="لم يتم ربط أي عقار بملف الملكية الخاص بك حتى الآن. تواصل مع المكتب لتحديث بيانات الملكية." />
        </Card>
      </>
    );
  }

  return (
    <>
      {welcome}
      {/* Hero */}
      <section className="card-warm p-5 md:p-6">
        <div className="flex items-center gap-3">
          <LogoMark size={40} />
          <div className="leading-tight">
            <div className="text-[13px] text-muted">{date(now)}</div>
            <h1 className="text-[20px] font-bold text-ink md:text-[22px]">أهلًا، {firstName}</h1>
          </div>
        </div>
        <div className="mt-5">
          <div className="text-[13px] font-semibold text-muted">صافي المستحق لك</div>
          <div className="num mt-1 text-[36px] font-extrabold leading-none text-brand md:text-[42px]">
            {money(netDue)} <span className="text-[16px] font-semibold text-muted">ر.س</span>
          </div>
          <div className="mt-1 text-[12.5px] text-muted">{statementsDue._count > 0 ? `من ${num(statementsDue._count)} كشف حساب معتمد بانتظار التحويل` : "لا توجد كشوف حساب مستحقة حاليًا"}</div>
        </div>
        <div className="mt-5 grid grid-cols-3 gap-3 border-t border-[#F0E2BF] pt-4">
          <Big label="الإشغال" value={pct(occupancy, 0)} sub={`${num(rented)} من ${num(totalUnits)} وحدة`} href="/owner/properties" />
          <Big label="تم تحصيله هذا الشهر" value={money(monthCollected)} sub={monthLabel(now)} href="/owner/collections" />
          <Big label="متأخرات" value={money(overdueAmt)} sub={`${num(arrears.length)} دفعة`} href="/owner/collections" tone={overdueAmt > 0 ? "text-danger" : undefined} />
        </div>
      </section>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        {/* Needs attention */}
        <Card title="يحتاج انتباهك" subtitle={attention.length ? `${num(attention.length)} بند` : undefined} className="xl:col-span-2" padded={false}>
          {attention.length === 0 ? (
            <EmptyState title="لا يوجد ما يحتاج انتباهك" description="العقود سارية والوحدات مؤجرة." />
          ) : (
            <ul className="divide-y divide-line">
              {attention.slice(0, 10).map((a, i) => (
                <li key={i}>
                  <Link href={a.href} className="flex items-center gap-3 px-5 py-3 hover:bg-mist">
                    <span className={`h-2.5 w-2.5 flex-none rounded-full ${a.tone === "danger" ? "bg-danger" : a.tone === "warning" ? "bg-warning" : "bg-info"}`} aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px] font-semibold text-text">{a.title}</span>
                      <span className="block truncate text-[12px] text-muted">{a.sub}</span>
                    </span>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-none text-faint" aria-hidden>
                      <path d="m15 6-6 6 6 6" />
                    </svg>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Last statement */}
        <Card title="آخر كشف حساب">
          {!lastStatement ? (
            <p className="text-[13px] text-muted">لم يصدر المكتب أي كشف حساب بعد. سيظهر هنا فور مراجعته.</p>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <span className="latin text-[13px] font-semibold text-text">{lastStatement.code}</span>
                <StatusTag value={lastStatement.status} map={STATEMENT_STATUS} />
              </div>
              <div className="text-[12.5px] text-muted">
                {monthLabel(lastStatement.periodStart)} · {lastStatement.property?.name ?? "كل العقارات"}
              </div>
              <div className="num text-[26px] font-extrabold text-brand">
                {money(lastStatement.netDue)} <span className="text-[13px] font-semibold text-muted">ر.س</span>
              </div>
              <Link href={`/owner/statements/${lastStatement.id}`} className="btn btn-primary w-full">
                عرض الكشف
              </Link>
              <Link href="/owner/statements" className="link block text-center text-[12.5px]">
                كل كشوف الحساب
              </Link>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}

function Big({ label, value, sub, href, tone }: { label: string; value: string; sub?: string; href: string; tone?: string }) {
  return (
    <Link href={href} className="block min-w-0 rounded-xl px-1 py-1 hover:bg-white/60">
      <div className="text-[12px] font-semibold text-muted">{label}</div>
      <div className={`num mt-0.5 text-[20px] font-extrabold leading-tight md:text-[24px] ${tone ?? "text-ink"}`}>{value}</div>
      {sub && <div className="truncate text-[11.5px] text-faint">{sub}</div>}
    </Link>
  );
}
