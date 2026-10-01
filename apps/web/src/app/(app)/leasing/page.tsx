import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { can, isScoped, propertyIdScope } from "@/lib/permissions";
import { LEAD_STAGES, LEAD_STAGE_ORDER, LEAD_SOURCES, UNIT_STATUS, UNIT_TYPES } from "@/lib/constants";
import { money, pct, date, datetime, startOfMonth, endOfMonth, relative, pageParam, startOfDay, endOfDay } from "@/lib/format";
import { PageHeader, Card, Table, StatusTag, EmptyState, Pagination, FilterBar, Input, Select, StatGrid, StatCard, Avatar } from "@/components/ui";
import { GuideCard } from "@/components/GuideCard";
import { MoreFilters } from "@/components/MoreFilters";
import { displayPhone } from "@/lib/phone";
import { textLike, phoneLike } from "@/lib/search";
import { teamWith } from "@/lib/team";

export const dynamic = "force-dynamic";
const PAGE = 25;

export default async function LeasingPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireStaff();
  const sp = await searchParams;
  const org = user.organizationId;
  const view = sp.view === "list" ? "list" : "board";
  const page = pageParam(sp.page);
  const q = sp.q?.trim();
  const scope = isScoped(user) ? { OR: [{ unitId: null }, { unit: { propertyId: { in: user.assignedPropertyIds } } }] } : {};

  const where = {
    organizationId: org,
    ...scope,
    ...(sp.stage ? { stage: sp.stage } : {}),
    ...(sp.source ? { source: sp.source } : {}),
    ...(sp.assignedToId ? { assignedToId: sp.assignedToId } : {}),
    ...(sp.unitId ? { unitId: sp.unitId } : {}),
    ...(q ? { AND: [{ OR: [{ name: textLike(q) }, { phone: phoneLike(q) }, { email: textLike(q) }] }] } : {}),
  };
  const include = {
    unit: { select: { id: true, number: true, property: { select: { id: true, name: true } } } },
    assignedTo: { select: { id: true, name: true } },
  };

  const now = new Date();
  const dayStart = startOfDay(now);
  const dayEnd = endOfDay(now);

  const [total, rows, users, unitOptions, vacantUnits, leadsThisMonth, viewingsToday, rentedCount, allLeadsCount] = await Promise.all([
    view === "list" ? db.lead.count({ where }) : Promise.resolve(0),
    view === "list"
      ? db.lead.findMany({ where, orderBy: { updatedAt: "desc" }, skip: (page - 1) * PAGE, take: PAGE, include })
      : db.lead.findMany({ where: { ...where, ...(sp.stage ? {} : { stage: { not: "LOST" } }) }, orderBy: { updatedAt: "desc" }, take: 400, include }),
    teamWith(org, "leasing.manage"),
    db.unit.findMany({ where: { organizationId: org, status: { not: "ARCHIVED" }, ...propertyIdScope(user) }, select: { id: true, number: true, property: { select: { name: true } } }, orderBy: { number: "asc" }, take: 300 }),
    db.unit.findMany({
      where: { organizationId: org, status: { in: ["VACANT", "AVAILABLE"] }, ...propertyIdScope(user) },
      orderBy: [{ property: { name: "asc" } }, { number: "asc" }],
      take: 40,
      include: { property: { select: { id: true, name: true } }, _count: { select: { leads: { where: { stage: { notIn: ["RENTED", "LOST"] } } } } } },
    }),
    db.lead.count({ where: { organizationId: org, ...scope, createdAt: { gte: startOfMonth(now), lte: endOfMonth(now) } } }),
    db.lead.count({ where: { organizationId: org, ...scope, viewingDate: { gte: dayStart, lte: dayEnd }, stage: { notIn: ["LOST"] } } }),
    db.lead.count({ where: { organizationId: org, ...scope, stage: "RENTED" } }),
    db.lead.count({ where: { organizationId: org, ...scope } }),
  ]);

  const hasFilters = Boolean(sp.q || sp.stage || sp.source || sp.assignedToId || sp.unitId);
  const conversion = allLeadsCount ? (rentedCount / allLeadsCount) * 100 : 0;
  const lostCount = view === "board" ? await db.lead.count({ where: { ...where, stage: "LOST" } }) : 0;
  const columns = [...LEAD_STAGE_ORDER, ...(sp.stage === "LOST" ? ["LOST"] : [])];
  const qs = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    Object.entries({ ...sp, ...extra }).forEach(([k, v]) => v && k !== "page" && p.set(k, v));
    const s = p.toString();
    return `/leasing${s ? `?${s}` : ""}`;
  };

  return (
    <>
      <PageHeader
        title="التأجير"
        actions={
          <>
            <div className="flex overflow-hidden rounded-lg border border-line text-[12.5px]">
              <Link href={qs({ view: undefined })} className={`px-3 py-1.5 ${view === "board" ? "bg-brand text-white" : "hover:bg-mist"}`}>
                لوحة المراحل
              </Link>
              <Link href={qs({ view: "list" })} className={`px-3 py-1.5 ${view === "list" ? "bg-brand text-white" : "hover:bg-mist"}`}>
                قائمة
              </Link>
            </div>
            {can(user, "leasing.manage") && (
              <Link href="/leasing/new" className="btn btn-primary btn-sm">
                إضافة عميل محتمل
              </Link>
            )}
          </>
        }
      />

      <GuideCard
        id="leasing"
        show={allLeadsCount === 0}
        title="التأجير: من أول اتصال حتى توقيع العقد"
        steps={[
          "سجّل طالب الإيجار ومصدره والوحدة التي يرغب بها.",
          "انقله بين المراحل: تواصل، معاينة، عرض، ثم عقد.",
          "عند الوصول لمرحلة العقد يُنشأ العقد من نفس البطاقة.",
        ]}
        cta={{ href: "/leasing/new", label: "إضافة طالب إيجار" }}
        secondary={{ href: "/units?status=VACANT", label: "الوحدات الشاغرة" }}
      />

      <StatGrid cols={4}>
        <StatCard label="وحدات شاغرة" value={money(vacantUnits.length)} tone={vacantUnits.length > 0 ? "warning" : undefined} href="/units?status=VACANT" />
        <StatCard label="عملاء هذا الشهر" value={money(leadsThisMonth)} />
        <StatCard label="معاينات اليوم" value={money(viewingsToday)} tone={viewingsToday > 0 ? "success" : undefined} />
        <StatCard label="نسبة التحويل" value={pct(conversion)} sub={`${rentedCount} تأجير من ${allLeadsCount} عميل`} />
      </StatGrid>

      <Card className="mt-4" padded={false}>
        <div className="px-4 pt-4">
          <FilterBar base="/leasing" hasFilters={hasFilters}>
            {view === "list" && <input type="hidden" name="view" value="list" />}
            <Input name="q" placeholder="بحث بالاسم أو الجوال" defaultValue={sp.q ?? ""} className="!w-52" />
            <Select name="stage" options={LEAD_STAGES} placeholder="كل المراحل" defaultValue={sp.stage ?? ""} className="!w-40" />
            <Select name="source" options={LEAD_SOURCES} placeholder="كل المصادر" defaultValue={sp.source ?? ""} className="!w-40" />
            <MoreFilters open={Boolean(sp.assignedToId || sp.unitId)}>
              <Select name="assignedToId" options={users.map((u) => ({ value: u.id, label: u.name }))} placeholder="كل الموظفين" defaultValue={sp.assignedToId ?? ""} className="!w-44" />
              <Select name="unitId" options={unitOptions.map((u) => ({ value: u.id, label: `${u.number} — ${u.property.name}` }))} placeholder="كل الوحدات" defaultValue={sp.unitId ?? ""} className="!w-52" />
            </MoreFilters>
          </FilterBar>
        </div>

        {view === "board" ? (
          rows.length === 0 && lostCount === 0 ? (
            <EmptyState
              title={hasFilters ? "لا توجد نتائج مطابقة" : "لا يوجد عملاء محتملون بعد"}
              description={hasFilters ? "جرّب تعديل الفلاتر." : "سجّل أول عميل محتمل لبدء متابعة التأجير."}
              action={!hasFilters && can(user, "leasing.manage") ? <Link href="/leasing/new" className="btn btn-primary">إضافة عميل محتمل</Link> : undefined}
            />
          ) : (
            <div className="overflow-x-auto px-4 pb-4">
              <div className="flex min-w-max gap-3">
                {columns.map((stage) => {
                  const items = rows.filter((r) => r.stage === stage);
                  return (
                    <div key={stage} className="kanban-col w-64 shrink-0">
                      <div className="mb-2 flex items-center justify-between px-1">
                        <StatusTag value={stage} map={LEAD_STAGES} />
                        <span className="pill-count">{items.length}</span>
                      </div>
                      <div className="space-y-2">
                        {items.length === 0 && <div className="rounded-xl border border-dashed border-line px-3 py-5 text-center text-[12px] text-faint">لا يوجد</div>}
                        {items.map((l) => (
                          <Link key={l.id} href={`/leasing/${l.id}`} className="block rounded-xl bg-white px-3 py-2.5 shadow-sm transition hover:shadow-card">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className="truncate text-[13.5px] font-bold text-text">{l.name}</div>
                                {l.phone && <div className="num text-[12px] text-muted">{displayPhone(l.phone)}</div>}
                              </div>
                              {l.assignedTo && <Avatar name={l.assignedTo.name} sm />}
                            </div>
                            <div className="mt-2 space-y-0.5 text-[12px] text-text-2">
                              <div>
                                {l.unit ? (
                                  <>
                                    <span className="latin font-semibold">{l.unit.number}</span> · {l.unit.property.name}
                                  </>
                                ) : (
                                  <span className="text-faint">بدون وحدة</span>
                                )}
                              </div>
                              <div className="flex items-center justify-between">
                                <span className="text-muted">{LEAD_SOURCES[l.source] ?? l.source}</span>
                                {l.offerAmount ? <span className="num font-semibold">{money(l.offerAmount)} ر.س</span> : null}
                              </div>
                              {l.viewingDate && (
                                <div className="text-info">
                                  معاينة: {datetime(l.viewingDate)} <span className="text-muted">({relative(l.viewingDate)})</span>
                                </div>
                              )}
                            </div>
                          </Link>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
              {sp.stage !== "LOST" && lostCount > 0 && (
                <div className="mt-3 text-[12.5px] text-muted">
                  عملاء منسحبون: <b className="num">{lostCount}</b> ·{" "}
                  <Link href={qs({ stage: "LOST", view: "list" })} className="link">
                    عرض القائمة
                  </Link>
                </div>
              )}
            </div>
          )
        ) : rows.length === 0 ? (
          <EmptyState
            title={hasFilters ? "لا توجد نتائج مطابقة" : "لا يوجد عملاء محتملون بعد"}
            description={hasFilters ? "جرّب تعديل الفلاتر." : "سجّل أول عميل محتمل لبدء متابعة التأجير."}
            action={!hasFilters && can(user, "leasing.manage") ? <Link href="/leasing/new" className="btn btn-primary">إضافة عميل محتمل</Link> : undefined}
          />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <th>العميل</th>
                  <th>الوحدة</th>
                  <th>المصدر</th>
                  <th>المرحلة</th>
                  <th>المعاينة</th>
                  <th className="num">العرض</th>
                  <th>المسؤول</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((l) => (
                  <tr key={l.id}>
                    <td>
                      <Link href={`/leasing/${l.id}`} className="cell-primary hover:text-brand">
                        {l.name}
                      </Link>
                      {l.phone && <div className="cell-sub num">{displayPhone(l.phone)}</div>}
                    </td>
                    <td>
                      {l.unit ? (
                        <>
                          <Link href={`/units/${l.unit.id}`} className="latin hover:text-brand">
                            {l.unit.number}
                          </Link>
                          <div className="cell-sub">{l.unit.property.name}</div>
                        </>
                      ) : (
                        <span className="text-faint">—</span>
                      )}
                    </td>
                    <td>{LEAD_SOURCES[l.source] ?? l.source}</td>
                    <td>
                      <StatusTag value={l.stage} map={LEAD_STAGES} />
                      {l.stage === "LOST" && l.lostReason && <div className="cell-sub">{l.lostReason}</div>}
                    </td>
                    <td>{l.viewingDate ? datetime(l.viewingDate) : "—"}</td>
                    <td className="num font-semibold">{money(l.offerAmount)}</td>
                    <td className="text-muted">
                      {l.assignedTo?.name ?? "—"}
                      <div className="cell-sub">آخر تحديث {date(l.updatedAt)}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination page={page} pageSize={PAGE} total={total} base="/leasing" params={sp} />
          </>
        )}
      </Card>

      <Card className="mt-4" padded={false} title={`الوحدات الشاغرة (${vacantUnits.length})`} actions={<Link href="/units?status=VACANT" className="link text-xs">كل الوحدات</Link>}>
        {vacantUnits.length === 0 ? (
          <EmptyState title="لا توجد وحدات شاغرة" description="كل الوحدات مؤجرة أو محجوزة حاليًا." />
        ) : (
          <Table>
            <thead>
              <tr>
                <th>الوحدة</th>
                <th>العقار</th>
                <th>النوع</th>
                <th className="num">الإيجار المستهدف</th>
                <th className="num">عملاء مهتمون</th>
                <th>الحالة</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {vacantUnits.map((u) => (
                <tr key={u.id}>
                  <td>
                    <Link href={`/units/${u.id}`} className="cell-primary latin hover:text-brand">
                      {u.number}
                    </Link>
                  </td>
                  <td>
                    <Link href={`/properties/${u.property.id}`} className="hover:text-brand">
                      {u.property.name}
                    </Link>
                  </td>
                  <td>{UNIT_TYPES[u.type] ?? u.type}</td>
                  <td className="num">{money(u.targetRent)}</td>
                  <td className="num">{u._count.leads}</td>
                  <td>
                    <StatusTag value={u.status} map={UNIT_STATUS} />
                  </td>
                  <td className="text-left">
                    {can(user, "leasing.manage") && (
                      <Link href={`/leasing/new?unitId=${u.id}`} className="btn btn-outline btn-xs">
                        إضافة عميل
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
