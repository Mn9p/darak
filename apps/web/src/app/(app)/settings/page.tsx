import Link from "next/link";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { PLANS } from "@/lib/constants";
import { safeJson, pct, date } from "@/lib/format";
import { PageHeader, Card, Progress, ActionButton, Tag, StatGrid, StatCard } from "@/components/ui";
import { toggleOnboarding } from "./actions";

export const dynamic = "force-dynamic";

const SECTIONS = [
  { href: "/settings/organization", title: "ملف المكتب والسياسات", desc: "الاسم، السجل التجاري، الرقم الضريبي، حدود الاعتماد وأيام السماح" },
  { href: "/settings/branches", title: "الفروع", desc: "فروع المكتب والفرع الرئيسي" },
  { href: "/settings/custom-fields", title: "الحقول المخصصة والوسوم", desc: "حقول إضافية للعقارات والوحدات والملاك والمستأجرين" },
  { href: "/settings/security", title: "الأمان والخصوصية", desc: "طريقة الدخول، الجلسات النشطة، حماية البيانات" },
  { href: "/settings/subscription", title: "الاشتراك والخطة", desc: "الخطة الحالية والاستخدام والترقية" },
  { href: "/settings/profile", title: "ملفي الشخصي", desc: "اسمك ورقم جوالك وبريدك وجلساتك" },
];

/** Same order as the dashboard's FirstSteps. Optional rows are shown but not counted in the readiness score. */
const CHECKLIST: { key: string; label: string; href: string; optional?: boolean }[] = [
  { key: "company", label: "بيانات المكتب", href: "/settings/organization" },
  { key: "owners", label: "إضافة الملاك", href: "/owners/new" },
  { key: "properties", label: "إضافة العقارات", href: "/properties/new" },
  { key: "units", label: "إضافة الوحدات", href: "/units/new" },
  { key: "contracts", label: "إدخال العقود النشطة", href: "/contracts/new" },
  { key: "employees", label: "دعوة الموظفين", href: "/employees/new" },
  { key: "integrations", label: "ربط التكاملات", href: "/integrations", optional: true },
  { key: "review", label: "مراجعة البيانات والتقارير", href: "/reports" },
  { key: "live", label: "الانطلاق الفعلي", href: "/dashboard" },
];
const SCORED = CHECKLIST.filter((c) => !c.optional);

export default async function SettingsPage() {
  const user = await requireStaff();
  const org = user.organizationId;
  const manage = can(user, "settings.manage");
  if (!manage) redirect("/settings/profile");

  const [o, users, owners, properties, units, contracts, integrations] = await Promise.all([
    db.organization.findUnique({ where: { id: org } }),
    db.user.count({ where: { organizationId: org, role: { notIn: ["OWNER", "TENANT"] } } }),
    db.owner.count({ where: { organizationId: org } }),
    db.property.count({ where: { organizationId: org } }),
    db.unit.count({ where: { organizationId: org } }),
    db.contract.count({ where: { organizationId: org, status: { in: ["ACTIVE", "EXPIRING_SOON", "RENEWAL_PENDING"] } } }),
    db.integration.count({ where: { organizationId: org, status: "CONNECTED" } }),
  ]);
  if (!o) redirect("/login");
  const ob = safeJson<Record<string, boolean>>(o.onboarding, {});
  const done: Record<string, boolean> = {
    company: Boolean(o.crNumber || o.vatNumber) && Boolean(o.phone || o.email),
    employees: users > 1,
    owners: owners > 0,
    properties: properties > 0,
    units: units > 0,
    contracts: contracts > 0,
    integrations: integrations > 0,
    review: Boolean(ob.review),
    live: Boolean(ob.live),
  };
  const completed = SCORED.filter((c) => done[c.key]).length;
  const progress = (completed / SCORED.length) * 100;
  const plan = PLANS[o.plan] ?? PLANS.PROFESSIONAL;

  return (
    <>
      <PageHeader title="الإعدادات" subtitle={`${o.name} · خطة ${plan.label}`} />

      <StatGrid cols={4}>
        <StatCard label="جاهزية المكتب" value={pct(progress, 0)} sub={<Progress value={progress} tone={progress < 50 ? "warn" : undefined} />} />
        <StatCard label="الوحدات المستخدمة" value={<span className="num">{units} / {o.unitsLimit}</span>} href="/settings/subscription" />
        <StatCard label="المستخدمون" value={<span className="num">{users} / {o.usersLimit}</span>} href="/employees" />
        <StatCard label="تجديد الاشتراك" value={date(o.renewalDate)} href="/settings/subscription" />
      </StatGrid>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <div className="grid gap-3 sm:grid-cols-2 xl:col-span-2">
          {SECTIONS.map((s) => (
            <Link key={s.href} href={s.href} className="card block p-4 transition hover:shadow-card">
              <span className="block font-bold text-text">{s.title}</span>
              <span className="mt-0.5 block text-[12.5px] text-muted">{s.desc}</span>
            </Link>
          ))}
        </div>

        <Card title="قائمة الجاهزية" subtitle={`${completed} من ${SCORED.length} خطوات مكتملة`} tone="warm">
          <div className="mb-3">
            <Progress value={progress} tone="sand" />
          </div>
          <ul className="space-y-2">
            {CHECKLIST.map((c) => {
              const ok = done[c.key];
              const manual = c.key === "review" || c.key === "live";
              return (
                <li key={c.key} className="flex items-center justify-between gap-2 text-[13px]">
                  <Link href={c.href} className={`flex items-center gap-2 ${ok ? "text-muted line-through" : "text-text hover:text-brand"}`}>
                    <span className={`grid h-5 w-5 place-items-center rounded-full text-[11px] ${ok ? "bg-success text-white" : "border border-line bg-white"}`}>{ok ? "✓" : ""}</span>
                    {c.label}
                  </Link>
                  {manual ? (
                    <ActionButton action={toggleOnboarding} hidden={{ key: c.key, value: ok ? "0" : "1" }} className="btn btn-ghost btn-xs">
                      {ok ? "إلغاء" : "تم"}
                    </ActionButton>
                  ) : c.optional && !ok ? (
                    <Tag tone="neutral" plain>
                      اختياري
                    </Tag>
                  ) : (
                    <Tag tone={ok ? "success" : "neutral"} plain>
                      {ok ? "مكتمل" : "لم يكتمل"}
                    </Tag>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      </div>
    </>
  );
}
