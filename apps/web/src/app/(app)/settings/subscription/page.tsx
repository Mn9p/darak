import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { PLANS, ORG_STATUS } from "@/lib/constants";
import { date, money, pct, daysFromToday } from "@/lib/format";
import { PageHeader, Card, StatusTag, Progress, ActionButton, Tag, KV, Alert, DL } from "@/components/ui";
import { requestUpgrade } from "../actions";

export const dynamic = "force-dynamic";

const ADDONS = [
  { name: "تقارير الملاك التفاعلية", desc: "تقارير وتسويات مباشرة للملاك", price: 199 },
  { name: "قناة واتساب", desc: "تذكيرات وإشعارات عبر واتساب", price: 149 },
  { name: "الربط البنكي", desc: "استيراد كشوف الحساب والمطابقة", price: 249 },
  { name: "الفوترة الإلكترونية", desc: "إصدار الفواتير وربطها مع منصة فاتورة", price: 299 },
  { name: "مستخدمون إضافيون", desc: "حزمة 5 مستخدمين", price: 99 },
];

export default async function SubscriptionPage() {
  const user = await requireStaff();
  if (!can(user, "settings.manage")) redirect("/forbidden");
  const org = user.organizationId;
  const [o, units, users, pending] = await Promise.all([
    db.organization.findUnique({ where: { id: org } }),
    db.unit.count({ where: { organizationId: org, status: { not: "ARCHIVED" } } }),
    db.user.count({ where: { organizationId: org, role: { notIn: ["OWNER", "TENANT"] }, status: { not: "INACTIVE" } } }),
    db.supportTicket.findFirst({ where: { organizationId: org, subject: { startsWith: "طلب ترقية" }, status: { in: ["OPEN", "IN_PROGRESS"] } }, orderBy: { createdAt: "desc" } }),
  ]);
  if (!o) redirect("/login");
  const plan = PLANS[o.plan] ?? PLANS.PROFESSIONAL;
  const unitsPct = (units / Math.max(1, o.unitsLimit)) * 100;
  const usersPct = (users / Math.max(1, o.usersLimit)) * 100;
  const daysToRenew = o.renewalDate ? daysFromToday(o.renewalDate) : null;
  const next = o.plan === "STARTER" ? "PROFESSIONAL" : o.plan === "PROFESSIONAL" ? "ENTERPRISE" : null;

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="الاشتراك والخطة"
        subtitle={`خطة ${plan.label} · الاستخدام الحالي مقابل حدود الخطة`}
        breadcrumbs={[{ label: "الإعدادات", href: "/settings" }, { label: "الاشتراك" }]}
        actions={
          next ? (
            pending ? (
              <Tag tone="info">طلب ترقية قيد المعالجة</Tag>
            ) : (
              <ActionButton action={requestUpgrade} hidden={{ plan: PLANS[next].label }} className="btn btn-primary btn-sm">
                ترقية إلى {PLANS[next].label}
              </ActionButton>
            )
          ) : undefined
        }
      />

      {daysToRenew !== null && daysToRenew <= 30 && (
        <div className="mb-4">
          <Alert tone={daysToRenew < 0 ? "danger" : "warning"} title={daysToRenew < 0 ? "انتهى الاشتراك" : "اقتراب موعد التجديد"}>
            {daysToRenew < 0 ? `انتهى الاشتراك قبل ${-daysToRenew} يومًا. يرجى التجديد لتجنب تعليق الحساب.` : `يُجدد الاشتراك خلال ${daysToRenew} يومًا (${date(o.renewalDate)}).`}
          </Alert>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="الخطة الحالية" tone="dark" className="lg:col-span-1">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-2xl font-bold text-sand-200">{plan.label}</span>
            <StatusTag value={o.status} map={ORG_STATUS} />
          </div>
          <DL
            cols={1}
            items={[
              { label: "السعر الشهري", value: <span className="num text-white">{plan.price ? `${money(plan.price)} ر.س` : "حسب الاتفاق"}</span> },
              { label: "تاريخ التجديد", value: <span className="num text-white">{date(o.renewalDate)}</span> },
              { label: "حد الوحدات", value: <span className="num text-white">{money(o.unitsLimit)}</span> },
              { label: "حد المستخدمين", value: <span className="num text-white">{o.usersLimit}</span> },
            ]}
          />
        </Card>

        <Card title="الاستخدام مقابل الحدود" className="lg:col-span-2">
          <div className="space-y-4">
            <div>
              <div className="mb-1 flex items-center justify-between text-[13px]">
                <span className="font-semibold text-text">الوحدات</span>
                <span className="num text-muted">
                  {units} / {o.unitsLimit} · {pct(unitsPct, 0)}
                </span>
              </div>
              <Progress value={unitsPct} tone={unitsPct >= 90 ? "danger" : unitsPct >= 75 ? "warn" : undefined} />
            </div>
            <div>
              <div className="mb-1 flex items-center justify-between text-[13px]">
                <span className="font-semibold text-text">المستخدمون</span>
                <span className="num text-muted">
                  {users} / {o.usersLimit} · {pct(usersPct, 0)}
                </span>
              </div>
              <Progress value={usersPct} tone={usersPct >= 90 ? "danger" : usersPct >= 75 ? "warn" : undefined} />
            </div>
            {(unitsPct >= 90 || usersPct >= 90) && <Alert tone="warning">اقتربت من حدود الخطة. يمكنك الترقية أو إضافة حزمة.</Alert>}
          </div>
          <div className="mt-4 border-t border-line pt-3">
            <div className="mb-2 text-[12.5px] font-bold text-muted">مقارنة الخطط</div>
            {Object.entries(PLANS).map(([k, p]) => (
              <KV
                key={k}
                k={`${p.label}${k === o.plan ? " (الحالية)" : ""}`}
                v={
                  <span className="num">
                    {money(p.units)} وحدة · {p.users} مستخدم · {p.price ? `${money(p.price)} ر.س/شهر` : "حسب الاتفاق"}
                  </span>
                }
              />
            ))}
          </div>
        </Card>
      </div>

      <div className="mt-4">
        <Card title="الإضافات" subtitle="تُفعَّل بطلب من فريق دارك وتُضاف إلى الفاتورة الشهرية.">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {ADDONS.map((a) => (
              <div key={a.name} className="rounded-xl border border-line p-3">
                <div className="font-bold text-text">{a.name}</div>
                <div className="text-[12.5px] text-muted">{a.desc}</div>
                <div className="num mt-2 text-[13px] font-semibold text-brand">{money(a.price)} ر.س / شهر</div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
