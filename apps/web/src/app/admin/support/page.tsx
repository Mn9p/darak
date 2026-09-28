import Link from "next/link";
import { requireSuperAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { num, datetime, relative, pageParam } from "@/lib/format";
import { displayPhone } from "@/lib/phone";
import { TICKET_STATUS, TICKET_PRIORITY } from "@/lib/constants";
import { PageHeader, Card, StatusTag, EmptyState, FilterBar, Select, Input, Pagination, StatGrid, StatCard, ActionButton, Textarea, Tag } from "@/components/ui";
import { updateTicketStatus, updateTicketPriority, replyToTicket } from "../actions";
import { textLike } from "@/lib/search";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 20;

export default async function SupportPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireSuperAdmin();
  const sp = await searchParams;
  const page = pageParam(sp.page);
  const q = sp.q?.trim();
  const status = sp.status ?? "open";

  const where = {
    ...(status === "open" ? { status: { in: ["OPEN", "IN_PROGRESS"] } } : status === "all" ? {} : { status }),
    ...(sp.priority ? { priority: sp.priority } : {}),
    ...(sp.org ? { organizationId: sp.org } : {}),
    ...(q ? { OR: [{ subject: textLike(q) }, { body: textLike(q) }, { organization: { name: textLike(q) } }] } : {}),
  };

  const [total, rows, orgs, byStatus, urgentOpen, oldestOpen] = await Promise.all([
    db.supportTicket.count({ where }),
    db.supportTicket.findMany({
      where,
      orderBy: [{ status: "asc" }, { priority: "desc" }, { createdAt: "asc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { organization: { select: { id: true, name: true, plan: true } }, user: { select: { name: true, phone: true, role: true } } },
    }),
    db.organization.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.supportTicket.groupBy({ by: ["status"], _count: true }),
    db.supportTicket.count({ where: { status: { in: ["OPEN", "IN_PROGRESS"] }, priority: { in: ["HIGH", "URGENT"] } } }),
    db.supportTicket.findFirst({ where: { status: "OPEN" }, orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
  ]);

  const count = (s: string) => byStatus.find((b) => b.status === s)?._count ?? 0;
  const openTotal = count("OPEN") + count("IN_PROGRESS");
  const hasFilters = Boolean(sp.q || sp.priority || sp.org || (sp.status && sp.status !== "open"));
  const statusOptions = [{ value: "open", label: "المفتوحة وقيد المعالجة" }, ...Object.entries(TICKET_STATUS).map(([value, m]) => ({ value, label: m.label })), { value: "all", label: "الكل" }];

  return (
    <>
      <PageHeader title="الدعم الفني" subtitle="تذاكر الدعم الواردة من المكاتب: الرد، تغيير الأولوية، والإغلاق" />

      <StatGrid cols={4}>
        <StatCard label="تذاكر مفتوحة" value={num(openTotal)} sub={`${num(count("OPEN"))} جديدة · ${num(count("IN_PROGRESS"))} قيد المعالجة`} tone={openTotal ? "warning" : undefined} dark />
        <StatCard label="عالية / عاجلة" value={num(urgentOpen)} tone={urgentOpen ? "danger" : undefined} href="/admin/support?priority=URGENT" />
        <StatCard label="أقدم تذكرة بلا رد" value={oldestOpen ? relative(oldestOpen.createdAt) : "—"} />
        <StatCard label="تم الحل" value={num(count("RESOLVED"))} sub={`${num(count("CLOSED"))} مغلقة`} href="/admin/support?status=RESOLVED" />
      </StatGrid>

      <Card className="mt-4" padded={false}>
        <div className="px-4 pt-4">
          <FilterBar base="/admin/support" hasFilters={hasFilters}>
            <Input name="q" defaultValue={q ?? ""} placeholder="بحث: الموضوع، النص، المكتب" className="!w-56" />
            <Select name="status" options={statusOptions} defaultValue={status} className="!w-44" />
            <Select name="priority" options={TICKET_PRIORITY} placeholder="كل الأولويات" defaultValue={sp.priority ?? ""} className="!w-36" />
            <Select name="org" options={orgs.map((o) => ({ value: o.id, label: o.name }))} placeholder="كل المكاتب" defaultValue={sp.org ?? ""} className="!w-44" />
          </FilterBar>
        </div>

        {rows.length === 0 ? (
          <EmptyState title={hasFilters ? "لا توجد تذاكر مطابقة" : "لا توجد تذاكر مفتوحة"} description={hasFilters ? "جرّب إزالة بعض الفلاتر." : "كل التذاكر الواردة تمت معالجتها."} action={hasFilters ? <Link href="/admin/support" className="btn btn-outline btn-sm">مسح الفلاتر</Link> : undefined} />
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((t) => (
              <li key={t.id} className="px-4 py-3">
                <details className="group">
                  <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2">
                    <StatusTag value={t.priority} map={TICKET_PRIORITY} />
                    <span className="min-w-0 flex-1 truncate text-[14px] font-bold text-text">{t.subject}</span>
                    <StatusTag value={t.status} map={TICKET_STATUS} />
                    <span className="text-[12px] text-muted">
                      <Link href={`/admin/organizations/${t.organization.id}?tab=support`} className="link">{t.organization.name}</Link>
                      {t.user ? ` · ${t.user.name}` : ""} · <span className="num">{relative(t.createdAt)}</span>
                    </span>
                  </summary>

                  <div className="mt-3 grid gap-4 xl:grid-cols-3">
                    <div className="xl:col-span-2">
                      <div className="mb-2 flex flex-wrap items-center gap-2 text-[11.5px] text-muted">
                        <span>أُنشئت <span className="num">{datetime(t.createdAt)}</span></span>
                        <span>· آخر تحديث <span className="num">{datetime(t.updatedAt)}</span></span>
                        {t.user && <Tag tone="neutral" plain><span className="num">{displayPhone(t.user.phone)}</span></Tag>}
                      </div>
                      <pre className="whitespace-pre-wrap rounded-xl bg-mist p-3 text-[13px] leading-6 text-text" dir="auto">{t.body}</pre>
                      <form action={replyToTicket} className="mt-3 space-y-2">
                        <input type="hidden" name="id" value={t.id} />
                        <Textarea name="reply" rows={3} required placeholder="اكتب رد فريق الدعم. يُلحق بالتذكرة ويُرسل إشعار لمقدم الطلب." />
                        <div className="flex justify-end">
                          <button type="submit" className="btn btn-primary btn-sm">إرسال الرد</button>
                        </div>
                      </form>
                    </div>

                    <div className="space-y-3">
                      <div className="rounded-xl border border-line p-3">
                        <div className="mb-2 text-[12px] font-semibold text-muted">الحالة</div>
                        <div className="flex flex-wrap gap-1">
                          {Object.entries(TICKET_STATUS).map(([k, m]) => (
                            <ActionButton key={k} action={updateTicketStatus} hidden={{ id: t.id, status: k }} className={`btn btn-xs ${t.status === k ? "btn-primary" : "btn-outline"}`}>
                              {m.label}
                            </ActionButton>
                          ))}
                        </div>
                      </div>
                      <div className="rounded-xl border border-line p-3">
                        <div className="mb-2 text-[12px] font-semibold text-muted">الأولوية</div>
                        <form action={updateTicketPriority} className="flex items-center gap-1">
                          <input type="hidden" name="id" value={t.id} />
                          <Select name="priority" options={TICKET_PRIORITY} defaultValue={t.priority} className="!h-8 !text-xs" />
                          <button type="submit" className="btn btn-outline btn-xs">حفظ</button>
                        </form>
                      </div>
                      <Link href={`/admin/organizations/${t.organization.id}?tab=support`} className="btn btn-ghost btn-sm w-full">دخول دعم فني لهذا المكتب</Link>
                    </div>
                  </div>
                </details>
              </li>
            ))}
          </ul>
        )}
        <Pagination page={page} pageSize={PAGE_SIZE} total={total} base="/admin/support" params={sp} />
      </Card>
    </>
  );
}
