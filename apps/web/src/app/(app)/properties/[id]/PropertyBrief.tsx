import { db } from "@/lib/db";
import { propertyBrief } from "@/lib/ai";
import { propertyClaims } from "@/lib/collections";
import type { SessionUser } from "@/lib/auth";
import { addDays, startOfYear } from "@/lib/format";
import { AssistantCard } from "@/components/AssistantCard";

/** Async server component: gathers the facts of one property and renders the assistant brief. Wrap in <Suspense>. */
export async function PropertyBrief({ user, property, className }: { user: SessionUser & { organizationId: string }; property: { id: string; name: string; type: string }; className?: string }) {
  const org = user.organizationId;
  const yearStart = startOfYear();
  const [units, { claims, stats }, expiring60, pendingExpenses, ytdAlloc, ytdExp] = await Promise.all([
    db.unit.findMany({ where: { organizationId: org, propertyId: property.id, status: { not: "ARCHIVED" } }, select: { status: true, currentRent: true } }),
    propertyClaims(user, property.id),
    db.contract.count({ where: { organizationId: org, propertyId: property.id, status: { in: ["ACTIVE", "EXPIRING_SOON", "RENEWAL_PENDING"] }, endDate: { lte: addDays(new Date(), 60) } } }),
    db.expense.count({ where: { organizationId: org, propertyId: property.id, approvalStatus: "PENDING" } }),
    db.paymentAllocation.findMany({
      where: { installment: { contract: { propertyId: property.id } }, payment: { organizationId: org, paidAt: { gte: yearStart }, status: { in: ["RECORDED", "APPROVED"] } } },
      select: { amount: true, installment: { select: { contract: { select: { managementFeePct: true } } } } },
    }),
    db.expense.aggregate({ where: { organizationId: org, propertyId: property.id, approvalStatus: "APPROVED", date: { gte: yearStart } }, _sum: { amount: true, vatAmount: true } }),
  ]);
  const rented = units.filter((u) => u.status === "RENTED").length;
  const vacant = units.filter((u) => ["VACANT", "AVAILABLE"].includes(u.status)).length;
  const late = claims.filter((c) => c.late > 0);
  const top = [...late].sort((a, b) => b.remaining - a.remaining)[0];
  const income = ytdAlloc.reduce((s, a) => s + a.amount, 0);
  const fees = ytdAlloc.reduce((s, a) => s + (a.amount * a.installment.contract.managementFeePct) / 100, 0);

  const { text, generated } = await propertyBrief({
    name: property.name,
    type: property.type,
    units: { total: units.length, rented, vacant },
    occupancy: units.length ? (rented / units.length) * 100 : 0,
    annualRent: units.reduce((s, u) => s + (u.currentRent ?? 0), 0),
    month: { due: stats.dueMonth, paid: stats.paidMonth },
    overdue: { amount: stats.overdueAmt, count: late.length, oldestDays: late.reduce((m, c) => Math.max(m, c.late), 0), enforceable: late.filter((c) => c.enforceable).length },
    expiring60,
    pendingExpenses,
    ytd: { income, expenses: (ytdExp._sum.amount ?? 0) + (ytdExp._sum.vatAmount ?? 0), fees },
    topDebtor: top ? { name: top.tenantName, amount: top.remaining, days: top.late } : null,
  });
  return <AssistantCard text={text} generated={generated} className={className} />;
}
