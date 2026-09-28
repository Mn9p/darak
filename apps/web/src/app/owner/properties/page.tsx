import Link from "next/link";
import { requireOwner } from "@/lib/auth";
import { db } from "@/lib/db";
import { money, pct, num } from "@/lib/format";
import { PROPERTY_TYPES, PROPERTY_STATUS } from "@/lib/constants";
import { PageHeader, Card, Table, StatusTag, Progress, EmptyState } from "@/components/ui";
import { getOwnerScope } from "../_scope";
import { getOrgSettings } from "@/lib/engine";
import { isArrears } from "@/lib/collections";

export const dynamic = "force-dynamic";

export default async function OwnerPropertiesPage() {
  const user = await requireOwner();
  const scope = await getOwnerScope(user);

  const [settings, units, overdueAll] = await Promise.all([
    getOrgSettings(scope.org),
    db.unit.groupBy({ by: ["propertyId", "status"], where: { organizationId: scope.org, propertyId: { in: scope.propertyIds }, status: { not: "ARCHIVED" } }, _count: true, _sum: { currentRent: true } }),
    db.installment.findMany({ where: { organizationId: scope.org, status: { in: ["OVERDUE", "PARTIALLY_PAID"] }, contract: { propertyId: { in: scope.propertyIds } } }, select: { amount: true, paidAmount: true, dueDate: true, status: true, contract: { select: { propertyId: true, paymentFrequency: true } } } }),
  ]);
  // Arrears = past the statutory grace only.
  const overdue = overdueAll.filter((i) => isArrears(i, settings));

  const rows = scope.properties.map((p) => {
    const pu = units.filter((u) => u.propertyId === p.id);
    const total = pu.reduce((s, u) => s + u._count, 0);
    const rented = pu.filter((u) => u.status === "RENTED").reduce((s, u) => s + u._count, 0);
    const rent = pu.reduce((s, u) => s + (u._sum.currentRent ?? 0), 0);
    const od = overdue.filter((i) => i.contract.propertyId === p.id).reduce((s, i) => s + (i.amount - i.paidAmount), 0);
    return { ...p, total, rented, occ: total ? (rented / total) * 100 : 0, rent, od };
  });

  return (
    <>
      <PageHeader title="عقاراتي" subtitle={`${num(rows.length)} عقار مرتبط بملف الملكية الخاص بك`} />
      <Card padded={false}>
        {rows.length === 0 ? (
          <EmptyState title="لا توجد عقارات" description="لم يتم ربط أي عقار بحسابك. تواصل مع المكتب لتحديث بيانات الملكية." />
        ) : (
          <Table>
            <thead>
              <tr>
                <th>العقار</th>
                <th>النوع</th>
                <th>المدينة</th>
                <th>نسبة ملكيتك</th>
                <th>الوحدات</th>
                <th>الإشغال</th>
                <th>الإيجار السنوي</th>
                <th>المتأخرات</th>
                <th>الحالة</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  <td>
                    <Link href={`/owner/properties/${p.id}`} className="link">
                      {p.name}
                    </Link>
                    <div className="latin text-[11px] text-muted">{p.code}</div>
                  </td>
                  <td>{PROPERTY_TYPES[p.type] ?? p.type}</td>
                  <td>{p.city ?? "—"}</td>
                  <td className="num">{pct(p.pct, 0)}</td>
                  <td className="num">{p.rented} / {p.total}</td>
                  <td>
                    <div className="flex items-center gap-2">
                      <div className="w-20"><Progress value={p.occ} /></div>
                      <span className="num text-[12px]">{pct(p.occ, 0)}</span>
                    </div>
                  </td>
                  <td className="num">{money(p.rent)}</td>
                  <td className={`num ${p.od > 0 ? "text-danger font-bold" : ""}`}>{money(p.od)}</td>
                  <td><StatusTag value={p.status} map={PROPERTY_STATUS} /></td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
