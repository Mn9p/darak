import Link from "next/link";
import { requireTenant } from "@/lib/auth";
import { db } from "@/lib/db";
import { money, date, num, daysFromToday, daysOverdue } from "@/lib/format";
import { CONTRACT_STATUS, INSTALLMENT_STATUS, PAYMENT_FREQUENCY, UNIT_TYPES, DOCUMENT_TYPES, RENEWAL_STATUS } from "@/lib/constants";
import { PageHeader, Card, Table, StatusTag, DL, EmptyState, StatGrid, StatCard } from "@/components/ui";
import { getTenantContract } from "../_scope";

export const dynamic = "force-dynamic";

export default async function TenantContractPage() {
  const user = await requireTenant();
  const c = await getTenantContract(user);

  if (!c) {
    return (
      <>
        <PageHeader title="عقدي" />
        <Card>
          <EmptyState title="لا يوجد عقد مرتبط بحسابك" description="إذا كان لديك عقد ساري، تواصل مع المكتب لربطه بحسابك." />
        </Card>
      </>
    );
  }

  const [documents, otherContracts] = await Promise.all([
    db.document.findMany({
      where: { organizationId: user.organizationId, visibility: "TENANT", OR: [{ entityType: "CONTRACT", entityId: c.id }, { entityType: "TENANT", entityId: user.tenantId }] },
      orderBy: { createdAt: "desc" },
    }),
    db.contract.findMany({ where: { organizationId: user.organizationId, tenantId: user.tenantId, id: { not: c.id }, status: { notIn: ["DRAFT", "CANCELLED"] } }, orderBy: { endDate: "desc" }, select: { id: true, code: true, startDate: true, endDate: true, status: true, totalAmount: true, unit: { select: { number: true } }, property: { select: { name: true } } } }),
  ]);

  const paid = c.installments.reduce((s, i) => s + i.paidAmount, 0);
  const total = c.installments.filter((i) => i.status !== "WAIVED").reduce((s, i) => s + i.amount, 0);
  const daysLeft = daysFromToday(c.endDate);

  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            العقد <span className="latin">{c.code}</span> <StatusTag value={c.status} map={CONTRACT_STATUS} />
          </span>
        }
        subtitle={`${c.property.name} — الوحدة ${c.unit.number}`}
        actions={<Link href="/tenant/payments" className="btn btn-outline btn-sm">الدفعات</Link>}
      />

      <StatGrid cols={3}>
        <StatCard label="المسدد" value={money(paid)} sub={`من ${money(total)} ر.س`} tone="success" />
        <StatCard label="المتبقي" value={money(total - paid)} />
        <StatCard label="ينتهي العقد" value={daysLeft >= 0 ? `${num(daysLeft)} يوم` : "منتهي"} sub={date(c.endDate)} tone={daysLeft >= 0 && daysLeft <= 60 ? "warning" : undefined} />
      </StatGrid>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card title="بيانات العقد" className="xl:col-span-2">
          <DL
            cols={3}
            items={[
              { label: "رقم العقد", value: <span className="latin">{c.code}</span> },
              { label: "الحالة", value: <StatusTag value={c.status} map={CONTRACT_STATUS} /> },
              { label: "العقار", value: c.property.name },
              { label: "الوحدة", value: `${c.unit.number} · ${UNIT_TYPES[c.unit.type] ?? c.unit.type}` },
              { label: "العنوان", value: [c.property.city, c.property.district, c.property.street].filter(Boolean).join(" — ") },
              { label: "تاريخ البداية", value: <span className="num">{date(c.startDate)}</span> },
              { label: "تاريخ النهاية", value: <span className="num">{date(c.endDate)}</span> },
              { label: "دورية الدفع", value: `${PAYMENT_FREQUENCY[c.paymentFrequency] ?? c.paymentFrequency} (${c.installmentsCount} دفعات)` },
              { label: "القيمة السنوية", value: <span className="num">{money(c.totalAmount)} ر.س</span> },
              { label: "ضريبة القيمة المضافة", value: <span className="num">{money(c.vatAmount)} ر.س</span> },
              ...(c.renewalStatus ? [{ label: "حالة التجديد", value: <StatusTag value={c.renewalStatus} map={RENEWAL_STATUS} /> }] : []),
              ...(c.terminationDate ? [{ label: "تاريخ الإنهاء", value: <span className="num">{date(c.terminationDate)}</span> }] : []),
            ]}
          />
        </Card>
        <Card title="مستندات العقد" subtitle="ما يشاركه المكتب معك">
          {documents.length === 0 ? (
            <p className="text-[13px] text-muted">لا توجد مستندات مشاركة معك بعد. <Link href="/tenant/documents" className="link">كل المستندات</Link></p>
          ) : (
            <ul className="divide-y divide-line">
              {documents.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-2 py-2 text-[13px]">
                  <div className="min-w-0">
                    <div className="truncate font-semibold">{d.name}</div>
                    <div className="text-[11px] text-muted">{DOCUMENT_TYPES[d.type] ?? d.type} · <span className="num">{date(d.createdAt)}</span></div>
                  </div>
                  {d.url ? <a className="btn btn-ghost btn-xs" href={d.url} target="_blank">فتح</a> : null}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="mt-4">
        <Card title="جدول الدفعات" subtitle="أقساط العقد وحالة سدادها" padded={false}>
          <Table>
            <thead>
              <tr>
                <th>#</th>
                <th>تاريخ الاستحقاق</th>
                <th>المبلغ</th>
                <th>المسدد</th>
                <th>المتبقي</th>
                <th>الحالة</th>
                <th>ملاحظة</th>
              </tr>
            </thead>
            <tbody>
              {c.installments.map((i) => (
                <tr key={i.id}>
                  <td className="num">{i.seq}</td>
                  <td className="num">{date(i.dueDate)}</td>
                  <td className="num">{money(i.amount)}</td>
                  <td className="num">{money(i.paidAmount)}</td>
                  <td className="num font-bold">{money(Math.max(0, i.amount - i.paidAmount))}</td>
                  <td><StatusTag value={i.status} map={INSTALLMENT_STATUS} /></td>
                  <td className="text-[12px] text-muted">{["OVERDUE", "PARTIALLY_PAID"].includes(i.status) && daysOverdue(i.dueDate) > 0 ? `متأخر ${daysOverdue(i.dueDate)} يوم` : i.status === "WAIVED" ? i.waivedReason ?? "معفى" : ""}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      </div>

      {otherContracts.length > 0 && (
        <div className="mt-4">
          <Card title="عقود سابقة" padded={false}>
            <Table>
              <thead>
                <tr>
                  <th>العقد</th>
                  <th>العقار / الوحدة</th>
                  <th>من</th>
                  <th>إلى</th>
                  <th>القيمة</th>
                  <th>الحالة</th>
                </tr>
              </thead>
              <tbody>
                {otherContracts.map((o) => (
                  <tr key={o.id}>
                    <td className="latin">{o.code}</td>
                    <td>{o.property.name} — {o.unit.number}</td>
                    <td className="num">{date(o.startDate)}</td>
                    <td className="num">{date(o.endDate)}</td>
                    <td className="num">{money(o.totalAmount)}</td>
                    <td><StatusTag value={o.status} map={CONTRACT_STATUS} /></td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
        </div>
      )}
    </>
  );
}
