import { notFound, redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { can, propertyScope } from "@/lib/permissions";
import { inputDate, date } from "@/lib/format";
import { PageHeader, Card, Select, Input, Tag, FilterBar } from "@/components/ui";
import { MoreMenu } from "@/components/MoreMenu";
import { MoreFilters } from "@/components/MoreFilters";
import { reportBySlug, reportAllowed, parseFilters, runReport, filtersToQuery, PERIODS } from "../queries";
import { SmartSummary, ReportStats, ReportChart, ReportTable, ReportPrintHeader } from "../ReportView";
import { PrintButton } from "../PrintButton";

export const dynamic = "force-dynamic";

export default async function ReportPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireStaff();
  const { slug } = await params;
  const sp = await searchParams;
  const meta = reportBySlug(slug);
  if (!meta) notFound();
  if (!reportAllowed(user, meta)) redirect("/forbidden");
  const org = user.organizationId;

  const f = parseFilters(sp);
  const [properties, owners] = await Promise.all([
    db.property.findMany({ where: { organizationId: org, status: { not: "ARCHIVED" }, ...propertyScope(user) }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.owner.findMany({ where: { organizationId: org, status: { not: "ARCHIVED" } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  // Property outside the user's scope → treat as not found (never leak other data).
  if (f.propertyId && !properties.some((p) => p.id === f.propertyId)) notFound();

  const result = await runReport(slug, user, f);
  const query = filtersToQuery(f);
  const hasFilters = Boolean(sp.period || sp.propertyId || sp.ownerId || sp.groupBy || sp.days);
  const canExport = can(user, "reports.export");

  const propertySelect = <Select name="propertyId" options={properties.map((p) => ({ value: p.id, label: p.name }))} placeholder="كل العقارات" defaultValue={f.propertyId ?? ""} className="!w-48" />;
  const ownerSelect = <Select name="ownerId" options={owners.map((o) => ({ value: o.id, label: o.name }))} placeholder={meta.needsOwner ? "اختر المالك" : "كل الملاك"} defaultValue={f.ownerId ?? ""} className="!w-48" />;

  return (
    <>
      <PageHeader
        title={meta.title}
        subtitle={meta.description}
        breadcrumbs={[{ label: "التقارير", href: "/reports" }, { label: meta.title }]}
        actions={
          <span className="contents no-print">
            {canExport ? (
              <a href={`/reports/${slug}/export?${query}${query ? "&" : ""}format=xlsx`} className="btn btn-primary btn-sm">
                تصدير Excel
              </a>
            ) : (
              <PrintButton className="btn btn-primary btn-sm" />
            )}
            <MoreMenu items={[canExport && { label: "تصدير CSV", href: `/reports/${slug}/export?${query}` }, canExport && { label: "طباعة", node: <PrintButton className="btn btn-ghost btn-sm" /> }]} />
          </span>
        }
      />

      <Card className="mb-4 no-print" padded={false}>
        <div className="px-4 pt-4">
          <FilterBar base={`/reports/${slug}`} hasFilters={hasFilters}>
            <Select name="period" options={PERIODS} defaultValue={f.period} className="!w-40" />
            {meta.needsOwner ? ownerSelect : propertySelect}
            {meta.groupBy && <Select name="groupBy" options={meta.groupBy.map((g) => ({ value: g.key, label: `تجميع: ${g.label}` }))} defaultValue={f.groupBy ?? meta.groupBy[0].key} className="!w-40" />}
            {meta.days && <Select name="days" options={[{ value: "30", label: "خلال 30 يوم" }, { value: "60", label: "خلال 60 يوم" }, { value: "90", label: "خلال 90 يوم" }]} defaultValue={String(f.days)} className="!w-36" />}
            <MoreFilters open={f.period === "custom" || Boolean(meta.needsOwner ? sp.propertyId : sp.ownerId)}>
              <Input name="from" type="date" defaultValue={f.period === "custom" ? inputDate(f.from) : ""} className="!w-40" title="من (للفترة المخصصة)" />
              <Input name="to" type="date" defaultValue={f.period === "custom" ? inputDate(f.to) : ""} className="!w-40" title="إلى (للفترة المخصصة)" />
              {meta.needsOwner ? propertySelect : ownerSelect}
            </MoreFilters>
          </FilterBar>
        </div>
      </Card>

      <div className="mb-3 flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
        <Tag tone="neutral" plain>
          الفترة: {PERIODS[f.period]} · {date(f.from)} — {date(f.to)}
        </Tag>
        {f.propertyId && (
          <Tag tone="info" plain>
            العقار: {properties.find((p) => p.id === f.propertyId)?.name}
          </Tag>
        )}
        {f.ownerId && (
          <Tag tone="info" plain>
            المالك: {owners.find((o) => o.id === f.ownerId)?.name ?? "—"}
          </Tag>
        )}
        <span className="mr-auto">
          {user.name} · {date(new Date())}
        </span>
      </div>

      <ReportPrintHeader orgName={user.organizationName ?? ""} title={meta.title} period={`${date(f.from)} — ${date(f.to)}`} />
      <SmartSummary text={result.summary} note={result.note} />
      <ReportStats stats={result.stats} />
      {result.chart && <ReportChart chart={result.chart} />}
      <ReportTable columns={result.columns} rows={result.rows} />
    </>
  );
}
