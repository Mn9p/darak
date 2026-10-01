import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { assertCan, can, matchPreset, normalizePermissions } from "@/lib/permissions";
import { ROLES, STAFF_ROLES, USER_STATUS } from "@/lib/constants";
import { money, relative, pageParam } from "@/lib/format";
import { PageHeader, Card, Table, StatusTag, EmptyState, Pagination, FilterBar, Input, Select, StatGrid, StatCard, Avatar, Tag } from "@/components/ui";
import { GuideCard } from "@/components/GuideCard";
import { MoreFilters } from "@/components/MoreFilters";
import { displayPhone } from "@/lib/phone";
import { textLike, phoneLike } from "@/lib/search";

export const dynamic = "force-dynamic";
const PAGE = 25;
const ROLE_OPTIONS = STAFF_ROLES.map((r) => ({ value: r, label: ROLES[r].label }));

/** "كل الصلاحيات" for owners, the preset name when the grant matches one, otherwise a count. */
function accessLabel(role: string, stored: string, allProperties: boolean) {
  if (role !== "EMPLOYEE") return <span className="font-semibold text-text">كل الصلاحيات</span>;
  const perms = normalizePermissions(stored);
  const preset = matchPreset(perms, allProperties);
  if (preset) return <span>{preset.label}</span>;
  return (
    <span>
      مخصصة · <span className="num">{perms.length - 1}</span>
    </span>
  );
}

export default async function EmployeesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireStaff();
  assertCan(user, "employees.view");
  const sp = await searchParams;
  const org = user.organizationId;
  const page = pageParam(sp.page);
  const q = sp.q?.trim();

  const where = {
    organizationId: org,
    role: sp.role && (STAFF_ROLES as string[]).includes(sp.role) ? sp.role : { in: STAFF_ROLES },
    ...(sp.status ? { status: sp.status } : {}),
    ...(sp.branchId ? { branchId: sp.branchId } : {}),
    ...(sp.department ? { department: sp.department } : {}),
    ...(q ? { OR: [{ name: textLike(q) }, { email: textLike(q) }, { employeeCode: textLike(q) }, { jobTitle: textLike(q) }, { phone: phoneLike(q) }] } : {}),
  };

  const [total, rows, branches, departments, statTotal, statActive, statNeverLoggedIn, orgRow] = await Promise.all([
    db.user.count({ where }),
    db.user.findMany({
      where,
      orderBy: [{ status: "asc" }, { name: "asc" }],
      skip: (page - 1) * PAGE,
      take: PAGE,
      include: { branch: { select: { name: true } }, manager: { select: { id: true, name: true } }, _count: { select: { assignments: true } } },
    }),
    db.branch.findMany({ where: { organizationId: org }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.user.findMany({ where: { organizationId: org, role: { in: STAFF_ROLES }, department: { not: null } }, select: { department: true }, distinct: ["department"] }),
    db.user.count({ where: { organizationId: org, role: { in: STAFF_ROLES } } }),
    db.user.count({ where: { organizationId: org, role: { in: STAFF_ROLES }, status: "ACTIVE" } }),
    db.user.count({ where: { organizationId: org, role: { in: STAFF_ROLES }, status: "ACTIVE", lastLoginAt: null } }),
    db.organization.findUnique({ where: { id: org }, select: { usersLimit: true } }),
  ]);

  const hasFilters = Boolean(sp.q || sp.role || sp.status || sp.branchId || sp.department);
  const deptOptions = departments.map((d) => d.department!).filter(Boolean).sort().map((d) => ({ value: d, label: d }));
  const limit = orgRow?.usersLimit ?? 0;

  return (
    <>
      <PageHeader
        title="فريق العمل"
        subtitle="صاحب الحساب يرى كل شيء. كل موظف يرى ما تمنحه له فقط."
        actions={
          can(user, "employees.manage") ? (
            <Link href="/employees/new" className="btn btn-primary btn-sm">
              إضافة عضو
            </Link>
          ) : undefined
        }
      />

      <GuideCard
        id="employees"
        show={statTotal <= 1 && !hasFilters}
        title="فريق العمل: من يعمل معك وما يراه كل منهم"
        steps={[
          "أضف العضو برقم جواله؛ يدخل برمز يصله برسالة نصية دون كلمة مرور.",
          "اختر الدور: صاحب حساب (كل شيء) أو موظف.",
          "للموظف اختر قالبًا جاهزًا (تحصيل، تأجير، محاسبة…) أو حدد صلاحياته بنفسك، وكل العقارات أو عقارات محددة.",
        ]}
        cta={{ href: "/employees/new", label: "إضافة عضو" }}
        secondary={{ href: "/settings", label: "إعدادات المكتب" }}
      />

      <StatGrid cols={4}>
        <StatCard label="أعضاء الفريق" value={money(statTotal)} sub={limit ? `الحد في الباقة: ${limit}` : undefined} tone={limit && statTotal >= limit ? "warning" : undefined} />
        <StatCard label="نشطون" value={money(statActive)} tone="success" href="/employees?status=ACTIVE" />
        <StatCard label="غير نشطين أو مدعوون" value={money(statTotal - statActive)} tone={statTotal - statActive > 0 ? "warning" : undefined} />
        <StatCard label="لم يسجلوا دخولًا" value={money(statNeverLoggedIn)} />
      </StatGrid>

      <Card className="mt-4" padded={false}>
        <div className="px-4 pt-4">
          <FilterBar base="/employees" hasFilters={hasFilters}>
            <Input name="q" placeholder="بحث بالاسم أو البريد أو الرقم الوظيفي" defaultValue={sp.q ?? ""} className="!w-60" />
            <Select name="role" options={ROLE_OPTIONS} placeholder="كل الأدوار" defaultValue={sp.role ?? ""} className="!w-40" />
            <Select name="status" options={USER_STATUS} placeholder="كل الحالات" defaultValue={sp.status ?? ""} className="!w-36" />
            <MoreFilters open={Boolean(sp.branchId || sp.department)}>
              <Select name="branchId" options={branches.map((b) => ({ value: b.id, label: b.name }))} placeholder="كل الفروع" defaultValue={sp.branchId ?? ""} className="!w-40" />
              <Select name="department" options={deptOptions} placeholder="كل الأقسام" defaultValue={sp.department ?? ""} className="!w-40" />
            </MoreFilters>
          </FilterBar>
        </div>
        {rows.length === 0 ? (
          <EmptyState
            title={hasFilters ? "لا توجد نتائج مطابقة" : "لا يوجد أعضاء بعد"}
            description={hasFilters ? "جرّب تعديل الفلاتر." : "أضف أعضاء فريقك وحدد صلاحياتهم."}
            action={!hasFilters && can(user, "employees.manage") ? <Link href="/employees/new" className="btn btn-primary">إضافة عضو</Link> : undefined}
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <th>العضو</th>
                <th>الدور</th>
                <th>الصلاحيات</th>
                <th>العقارات</th>
                <th>الفرع</th>
                <th>الحالة</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id}>
                  <td>
                    <span className="flex items-center gap-2.5">
                      <Avatar name={e.name} sm />
                      <span>
                        <Link href={`/employees/${e.id}`} className="cell-primary hover:text-brand">
                          {e.name}
                        </Link>
                        {e.id === user.id && (
                          <Tag tone="brand" plain className="mr-1">
                            أنت
                          </Tag>
                        )}
                        <div className="cell-sub">
                          <span className="num">{displayPhone(e.phone)}</span>
                          {e.email && (
                            <>
                              {" · "}
                              <span className="latin">{e.email}</span>
                            </>
                          )}
                        </div>
                      </span>
                    </span>
                  </td>
                  <td>
                    <StatusTag value={e.role} map={ROLES} />
                    {e.jobTitle && <div className="cell-sub">{e.jobTitle}</div>}
                  </td>
                  <td>{accessLabel(e.role, e.permissions, e.allProperties)}</td>
                  <td>
                    {e.role !== "EMPLOYEE" || e.allProperties ? (
                      <span className="text-muted">كل العقارات</span>
                    ) : (
                      <span>
                        <span className="num">{e._count.assignments}</span> عقار
                      </span>
                    )}
                  </td>
                  <td className="text-muted">{e.branch?.name ?? "—"}</td>
                  <td>
                    <StatusTag value={e.status} map={USER_STATUS} />
                    <div className="cell-sub">{e.lastLoginAt ? `آخر دخول ${relative(e.lastLoginAt)}` : "لم يسجل دخولًا"}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <Pagination page={page} pageSize={PAGE} total={total} base="/employees" params={sp} />
      </Card>
    </>
  );
}
