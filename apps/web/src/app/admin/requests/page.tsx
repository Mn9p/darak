import Link from "next/link";
import { requireSuperAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { num, datetime, relative } from "@/lib/format";
import { displayPhone, normalizePhone } from "@/lib/phone";
import { ACCESS_REQUEST_STATUS } from "@/lib/constants";
import { PageHeader, Card, Table, StatusTag, EmptyState, Pagination, DataToolbar, Select, StatGrid, StatCard, ActionButton, Textarea } from "@/components/ui";
import { setAccessRequestStatus, setAccessRequestNote } from "../actions";
import { textLike } from "@/lib/search";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 25;

export default async function AccessRequestsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireSuperAdmin();
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const q = sp.q?.trim();
  const status = sp.status && sp.status in ACCESS_REQUEST_STATUS ? sp.status : undefined;
  // A phone typed in any form (05…, +966…) should match the normalized column.
  const qPhone = q ? normalizePhone(q) : null;

  const where = {
    ...(status ? { status } : {}),
    ...(q ? { OR: [{ name: textLike(q) }, { company: textLike(q) }, { phone: { contains: qPhone ?? q } }, { city: textLike(q) }] } : {}),
  };

  const [total, rows, byStatus] = await Promise.all([
    db.accessRequest.count({ where }),
    db.accessRequest.findMany({ where, orderBy: [{ createdAt: "desc" }], skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE }),
    db.accessRequest.groupBy({ by: ["status"], _count: true }),
  ]);

  const count = (s: string) => byStatus.find((b) => b.status === s)?._count ?? 0;
  const hasFilters = Boolean(q || status);
  const chips = [{ key: "status", label: `الحالة: ${status ? ACCESS_REQUEST_STATUS[status].label : ""}` }];

  return (
    <>
      <PageHeader title="طلبات الحسابات" subtitle="الطلبات الواردة من نموذج «اطلب حسابًا» في الصفحة الرئيسية: تواصل مع مقدّم الطلب ثم أنشئ المكتب من هنا" />

      <StatGrid cols={4}>
        <StatCard label="جديدة" value={num(count("NEW"))} tone={count("NEW") ? "warning" : undefined} href="/admin/requests?status=NEW" dark />
        <StatCard label="تم التواصل" value={num(count("CONTACTED"))} href="/admin/requests?status=CONTACTED" />
        <StatCard label="تم إنشاء المكتب" value={num(count("CONVERTED"))} href="/admin/requests?status=CONVERTED" />
        <StatCard label="مغلقة" value={num(count("CLOSED"))} href="/admin/requests?status=CLOSED" />
      </StatGrid>

      <Card className="mt-4" padded={false}>
        <div className="px-4 pt-4">
          <DataToolbar base="/admin/requests" q={q ?? ""} placeholder="بحث: الاسم، المكتب، الجوال" params={sp} count={total} chips={chips}>
            <Select name="status" options={ACCESS_REQUEST_STATUS} placeholder="كل الحالات" defaultValue={status ?? ""} className="!w-44" />
          </DataToolbar>
        </div>

        {rows.length === 0 ? (
          <EmptyState
            title={hasFilters ? "لا توجد طلبات مطابقة" : "لا توجد طلبات بعد"}
            description={hasFilters ? "جرّب إزالة بعض الفلاتر." : "تصل الطلبات من نموذج «اطلب حسابًا» في الصفحة الرئيسية."}
            action={
              hasFilters ? (
                <Link href="/admin/requests" className="btn btn-outline btn-sm">مسح الفلاتر</Link>
              ) : (
                <Link href="/admin/organizations/new" className="btn btn-primary btn-sm">إنشاء مكتب يدويًا</Link>
              )
            }
          />
        ) : (
          <Table density="compact">
            <thead>
              <tr>
                <th>التاريخ</th>
                <th>الاسم / المكتب</th>
                <th>الجوال</th>
                <th>المدينة</th>
                <th>الرسالة</th>
                <th>الحالة</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const intl = normalizePhone(r.phone) ?? r.phone.replace(/\D/g, "");
                const open = r.status === "NEW" || r.status === "CONTACTED";
                return (
                  <tr key={r.id} className="align-top">
                    <td className="whitespace-nowrap">
                      <span className="num" title={datetime(r.createdAt)}>{relative(r.createdAt)}</span>
                    </td>
                    <td>
                      <div className="font-semibold text-text">{r.name}</div>
                      <div className="text-[12px] text-muted">{r.company}</div>
                    </td>
                    <td className="whitespace-nowrap">
                      <a href={`tel:+${intl}`} className="link num" title="اتصال">{displayPhone(r.phone)}</a>
                      <div className="mt-0.5 flex gap-2 text-[11.5px]">
                        <a href={`https://wa.me/${intl}`} target="_blank" rel="noopener noreferrer" className="link">واتساب</a>
                        <a href={`tel:+${intl}`} className="link">اتصال</a>
                      </div>
                    </td>
                    <td>{r.city ?? "—"}</td>
                    <td className="max-w-xs">
                      {r.message ? (
                        <div className="line-clamp-2 text-[12.5px] text-text-2" title={r.message} dir="auto">{r.message}</div>
                      ) : (
                        <span className="text-faint">—</span>
                      )}
                      <details className="mt-1 text-[11.5px]">
                        <summary className="cursor-pointer list-none text-muted hover:text-text">
                          {r.note ? <span dir="auto">ملاحظة: {r.note.length > 60 ? `${r.note.slice(0, 60)}…` : r.note}</span> : "إضافة ملاحظة"}
                        </summary>
                        <form action={setAccessRequestNote} className="mt-1.5 space-y-1.5">
                          <input type="hidden" name="id" value={r.id} />
                          <Textarea name="note" rows={2} defaultValue={r.note ?? ""} placeholder="ملاحظة داخلية: نتيجة التواصل، الموعد، السبب…" className="!text-[12px]" />
                          <button type="submit" className="btn btn-outline btn-xs">حفظ الملاحظة</button>
                        </form>
                      </details>
                    </td>
                    <td className="whitespace-nowrap"><StatusTag value={r.status} map={ACCESS_REQUEST_STATUS} /></td>
                    <td className="whitespace-nowrap">
                      <div className="flex flex-wrap items-center justify-end gap-1">
                        {r.status === "NEW" && (
                          <ActionButton action={setAccessRequestStatus} hidden={{ id: r.id, status: "CONTACTED" }} className="btn btn-outline btn-xs">
                            تم التواصل
                          </ActionButton>
                        )}
                        {open && (
                          <Link href={`/admin/organizations/new?requestId=${r.id}`} className="btn btn-primary btn-xs">إنشاء المكتب</Link>
                        )}
                        {open && (
                          <ActionButton action={setAccessRequestStatus} hidden={{ id: r.id, status: "CLOSED" }} className="btn btn-ghost btn-xs" confirm="إغلاق الطلب دون إنشاء مكتب؟ يمكن إعادة فتحه لاحقًا.">
                            إغلاق
                          </ActionButton>
                        )}
                        {r.status === "CLOSED" && (
                          <ActionButton action={setAccessRequestStatus} hidden={{ id: r.id, status: "NEW" }} className="btn btn-ghost btn-xs">
                            إعادة فتح
                          </ActionButton>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
        <Pagination page={page} pageSize={PAGE_SIZE} total={total} base="/admin/requests" params={sp} />
      </Card>
    </>
  );
}
