import { dailyBrief } from "@/lib/ai";
import { date } from "@/lib/format";
import { propertyCollectionBoard } from "@/lib/collections";
import type { SessionUser } from "@/lib/auth";
import { AssistantCard } from "@/components/AssistantCard";

/** Async server component for the dashboard header: three lines on today. Wrap in <Suspense>. */
export async function DailyBrief({ user, expiring30, vacant, pendingExpenses, brokenPromises }: { user: SessionUser & { organizationId: string }; expiring30: number; vacant: number; pendingExpenses: number; brokenPromises: number }) {
  const { rows, totals } = await propertyCollectionBoard(user);
  const top = [...rows].sort((a, b) => b.overdueAmt - a.overdueAmt)[0];
  const { text, generated } = await dailyBrief({
    managerName: user.name,
    date: date(new Date()),
    overdue: { amount: totals.overdueAmt, count: rows.reduce((s, r) => s + r.overdueCount, 0), enforceable: totals.enforceable },
    promisesToday: totals.promisesToday,
    brokenPromises,
    expiring30,
    vacant,
    pendingExpenses,
    collectionRate: totals.dueMonth ? (totals.paidMonth / totals.dueMonth) * 100 : 0,
    monthCollected: totals.paidMonth,
    topProperty: top && top.overdueAmt > 0 ? { name: top.name, overdue: top.overdueAmt } : null,
  });
  return <AssistantCard title="ملخص اليوم" text={text} generated={generated} tone="dark" />;
}
