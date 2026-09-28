import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { propertyCollectionBoard } from "@/lib/collections";
import { money, pct, num } from "@/lib/format";
import { PageHeader, Card, Table, EmptyState, StatGrid, StatCard, Progress, Tag } from "@/components/ui";
import { GuideCard } from "@/components/GuideCard";
import { MoreMenu } from "@/components/MoreMenu";
import { ClaimsList } from "./ClaimsList";

export const dynamic = "force-dynamic";

/**
 * التحصيل — property first. Each row is a property with its collection health; the row opens the property's
 * collections workspace where every action lives. `?view=list` keeps the flat claims list (saved views, bulk assign).
 */
export default async function CollectionsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireStaff();
  const sp = await searchParams;
  if (sp.view === "list") return <ClaimsList user={user} sp={sp} />;

  const { rows, totals } = await propertyCollectionBoard(user);
  const rate = totals.dueMonth ? (totals.paidMonth / totals.dueMonth) * 100 : 0;
  const withIssues = rows.filter((r) => r.overdueAmt > 0 || r.openCases > 0);
  const clean = rows.filter((r) => !(r.overdueAmt > 0 || r.openCases > 0));
  const ordered = [...withIssues.sort((a, b) => b.overdueAmt - a.overdueAmt), ...clean];

  return (
    <>
      <PageHeader
        title="التحصيل"
        subtitle="ابدأ من العقار: افتحه لترى مطالباته وتتابعها من مكان واحد."
        actions={
          <>
            {can(user, "payments.manage") && (
              <Link href="/payments/new" className="btn btn-primary btn-sm">
                تسجيل سند قبض
              </Link>
            )}
            <Link href="/collections?view=list" className="btn btn-outline btn-sm">
              كل المطالبات
            </Link>
            <MoreMenu
              items={[
                { label: "جدول الدفعات", href: "/installments" },
                { label: "وعود مكسورة", href: "/collections?view=list&followUpStatus=BROKEN_PROMISE" },
                { label: "مطالبات مصعّدة", href: "/collections?view=list&followUpStatus=ESCALATED" },
                { label: "مطالباتي", href: "/collections?view=list&mine=1" },
                { label: "سندات القبض", href: "/payments" },
              ]}
            />
          </>
        }
      />

      <GuideCard
        id="collections"
        show={rows.length === 0}
        title="التحصيل يبدأ من العقار: افتحه لترى مطالباته"
        steps={[
          "أضف عقارًا ووحداته وفعّل عقودها.",
          "الدفعات التي تتجاوز مهلة السداد تتحول تلقائيًا إلى مطالبات هنا.",
          "من صفحة العقار تسجّل الوعود والتواصل وتصعّد المطالبة عند الحاجة.",
        ]}
        note="المطالبات لا تُنشأ يدويًا؛ تُفتح وتُغلق من حالة الدفعات."
        cta={{ href: "/properties/new", label: "إضافة عقار" }}
        secondary={{ href: "/installments", label: "جدول الدفعات" }}
      />

      <StatGrid cols={4}>
        <StatCard label="إجمالي المتأخر" value={money(totals.overdueAmt)} tone={totals.overdueAmt > 0 ? "danger" : undefined} sub={`${num(rows.reduce((s, r) => s + r.overdueCount, 0))} دفعة`} />
        <StatCard label="نسبة التحصيل هذا الشهر" value={totals.dueMonth ? pct(rate) : "—"} sub={totals.dueMonth ? `${money(totals.paidMonth)} من ${money(totals.dueMonth)} ر.س` : "لا مستحقات هذا الشهر"} tone={totals.dueMonth && rate < 75 ? "warning" : undefined} />
        <StatCard label="تجاوزت مهلة السداد" value={num(totals.enforceable)} sub="يمكن طلب التنفيذ عبر ناجز" tone={totals.enforceable > 0 ? "warning" : undefined} />
        <StatCard label="وعود تستحق اليوم" value={num(totals.promisesToday)} sub={totals.unassigned > 0 ? `${num(totals.unassigned)} مطالبة بلا محصل` : "كل المطالبات مسندة"} dark href="/collections?view=list&followUpStatus=PROMISE_TO_PAY" />
      </StatGrid>

      <Card className="mt-4" padded={false} title="العقارات" subtitle="مرتبة حسب المتأخر. اضغط العقار لفتح مطالباته.">
        {rows.length === 0 ? (
          <EmptyState title="لا توجد عقارات" description="أضف عقارًا ووحداته وعقودها ليبدأ التحصيل." action={can(user, "properties.manage") ? <Link href="/properties/new" className="btn btn-primary">إضافة عقار</Link> : undefined} />
        ) : (
          <Table density="compact">
            <thead>
              <tr>
                <th>العقار</th>
                <th>هذا الشهر</th>
                <th className="num">المتأخر</th>
                <th>مهلة السداد</th>
                <th>المتابعة</th>
                <th className="num">مطالبات</th>
              </tr>
            </thead>
            <tbody>
              {ordered.map((r) => {
                const href = `/properties/${r.id}?tab=collections`;
                return (
                  <tr key={r.id}>
                    <td>
                      <Link href={href} className="cell-primary hover:text-brand">
                        {r.name}
                      </Link>
                      <div className="cell-sub">
                        <span className="num">{r.units.rented}</span>/<span className="num">{r.units.total}</span> وحدة مؤجرة{r.city ? ` · ${r.city}` : ""}
                      </div>
                    </td>
                    <td>
                      <div className="flex items-center gap-2">
                        <div className="w-24">
                          <Progress value={r.rate} tone={r.dueMonth && r.rate < 60 ? "danger" : r.dueMonth && r.rate < 85 ? "warn" : undefined} />
                        </div>
                        <span className="num text-[12.5px]">{r.dueMonth ? `${Math.round(r.rate)}%` : "—"}</span>
                      </div>
                      <div className="cell-sub num">
                        {money(r.paidMonth)} / {money(r.dueMonth)}
                      </div>
                    </td>
                    <td className={`num font-bold ${r.overdueAmt > 0 ? "text-danger" : "text-muted"}`}>
                      {r.overdueAmt > 0 ? money(r.overdueAmt) : "—"}
                      {r.overdueCount > 0 && (
                        <div className="cell-sub num">
                          {r.overdueCount} دفعة · أقدمها {r.oldestLate} يوم
                        </div>
                      )}
                    </td>
                    <td>
                      {r.enforceable > 0 ? (
                        <Tag tone="warning">
                          <span className="num">{r.enforceable}</span> تجاوزت المهلة
                        </Tag>
                      ) : r.overdueCount > 0 ? (
                        <Tag tone="info" plain>
                          ضمن المهلة
                        </Tag>
                      ) : (
                        <span className="text-faint">—</span>
                      )}
                    </td>
                    <td className="text-[12.5px]">
                      {r.promisesToday > 0 && <div>وعود اليوم: <b className="num">{r.promisesToday}</b></div>}
                      {r.broken > 0 && <div className="text-danger">وعود مكسورة: <b className="num">{r.broken}</b></div>}
                      {r.unassigned > 0 && <div className="text-warning">بلا محصل: <b className="num">{r.unassigned}</b></div>}
                      {!r.promisesToday && !r.broken && !r.unassigned && <span className="text-faint">لا شيء عالق</span>}
                    </td>
                    <td className="num">
                      <Link href={href} className={`btn btn-xs ${r.openCases > 0 ? "btn-primary" : "btn-ghost"}`}>
                        {r.openCases > 0 ? `${r.openCases} مطالبة` : "فتح"}
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
