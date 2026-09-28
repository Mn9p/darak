import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { can, isScoped, propertyScope, propertyIdScope, contractScope } from "@/lib/permissions";
import { textLike, phoneLike } from "@/lib/search";

export const dynamic = "force-dynamic";
const LIMIT = 5;

export type SearchHit = { group: string; label: string; sub?: string; href: string };

/** JSON search for the command palette. Staff only; every query is org + scope filtered. */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user || !user.organizationId || user.role === "OWNER" || user.role === "TENANT" || user.role === "SUPER_ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim();
  if (q.length < 2) return NextResponse.json({ hits: [] });

  const org = user.organizationId;
  const like = textLike(q);
  const pScope = propertyScope(user);
  const pidScope = propertyIdScope(user);
  const cScope = contractScope(user);

  const [properties, units, tenants, owners, contracts, payments] = await Promise.all([
    can(user, "properties.view") ? db.property.findMany({ where: { organizationId: org, ...pScope, OR: [{ name: like }, { code: like }, { district: like }] }, take: LIMIT, select: { id: true, name: true, code: true, city: true } }) : [],
    can(user, "units.view") ? db.unit.findMany({ where: { organizationId: org, ...pidScope, OR: [{ number: like }, { code: like }] }, take: LIMIT, select: { id: true, number: true, code: true, property: { select: { name: true } } } }) : [],
    can(user, "tenants.view") ? db.tenant.findMany({ where: { organizationId: org, ...(cScope.contract ? { contracts: { some: { propertyId: cScope.contract.propertyId } } } : {}), OR: [{ name: like }, { phone: phoneLike(q) }, { code: like }] }, take: LIMIT, select: { id: true, name: true, code: true, phone: true } }) : [],
    can(user, "owners.view") ? db.owner.findMany({ where: { organizationId: org, status: { not: "ARCHIVED" }, ...(isScoped(user) ? { ownerships: { some: { propertyId: { in: user.assignedPropertyIds } } } } : {}), OR: [{ name: like }, { phone: phoneLike(q) }, { code: like }] }, take: LIMIT, select: { id: true, name: true, code: true } }) : [],
    can(user, "contracts.view") ? db.contract.findMany({ where: { organizationId: org, ...pidScope, OR: [{ code: like }, { tenant: { name: like } }] }, take: LIMIT, select: { id: true, code: true, tenant: { select: { name: true } }, unit: { select: { number: true } } } }) : [],
    can(user, "payments.view") ? db.payment.findMany({ where: { organizationId: org, ...cScope, OR: [{ code: like }, { reference: like }] }, take: LIMIT, select: { id: true, code: true, amount: true, tenant: { select: { name: true } } } }) : [],
  ]);

  const hits: SearchHit[] = [
    ...properties.map((p) => ({ group: "العقارات", label: p.name, sub: [p.code, p.city].filter(Boolean).join(" · "), href: `/properties/${p.id}` })),
    ...units.map((u) => ({ group: "الوحدات", label: `وحدة ${u.number}`, sub: u.property.name, href: `/units/${u.id}` })),
    ...tenants.map((t) => ({ group: "المستأجرون", label: t.name, sub: t.phone ?? t.code ?? undefined, href: `/tenants/${t.id}` })),
    ...owners.map((o) => ({ group: "الملاك", label: o.name, sub: o.code ?? undefined, href: `/owners/${o.id}` })),
    ...contracts.map((c) => ({ group: "العقود", label: c.code, sub: `${c.tenant?.name ?? ""} · وحدة ${c.unit?.number ?? ""}`, href: `/contracts/${c.id}` })),
    ...payments.map((p) => ({ group: "سندات القبض", label: p.code, sub: p.tenant?.name ?? undefined, href: `/payments/${p.id}` })),
  ];
  return NextResponse.json({ hits });
}
