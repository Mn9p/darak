import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser, type SessionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getFile, fileOwnerOrg, fileUrl } from "@/lib/storage";
import { getOwnerScope, ownedContractIds } from "@/app/owner/_scope";

export const dynamic = "force-dynamic";

/**
 * Private file delivery.
 * Staff: must belong to the organization that owns the file.
 * Owner / tenant portal users: only files behind a Document shared with them (same visibility rules as their
 * documents pages) or the receipt attached to one of the tenant's own payments.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ key: string[] }> }) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });
  const { key: parts } = await ctx.params;
  const key = parts.join("/");
  if (key.includes("..") || key.includes("\\")) return new NextResponse("Bad request", { status: 400 });
  const org = await fileOwnerOrg(key);
  if (!org) return new NextResponse("Not found", { status: 404 });
  if (user.role !== "SUPER_ADMIN" && org !== user.organizationId) return new NextResponse("Forbidden", { status: 403 });
  if ((user.role === "OWNER" || user.role === "TENANT") && !(await portalMayRead(user, key))) return new NextResponse("Forbidden", { status: 403 });

  const f = await getFile(key);
  if (!f) return new NextResponse("Not found", { status: 404 });
  const inline = /^image\/|^application\/pdf$/.test(f.contentType);
  return new NextResponse(new Uint8Array(f.body), {
    headers: {
      "Content-Type": f.contentType,
      "Content-Length": String(f.body.length),
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(f.name)}`,
      "Cache-Control": "private, max-age=300",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

async function portalMayRead(user: SessionUser, key: string): Promise<boolean> {
  const url = fileUrl(key);
  const orgId = user.organizationId!;
  if (user.role === "TENANT" && user.tenantId) {
    const contractIds = (await db.contract.findMany({ where: { organizationId: orgId, tenantId: user.tenantId }, select: { id: true } })).map((c) => c.id);
    const [doc, receipt] = await Promise.all([
      db.document.count({
        where: { organizationId: orgId, url, visibility: "TENANT", OR: [{ entityType: "TENANT", entityId: user.tenantId }, { entityType: "CONTRACT", entityId: { in: contractIds } }] },
      }),
      db.payment.count({ where: { organizationId: orgId, tenantId: user.tenantId, attachmentUrl: url } }),
    ]);
    return doc > 0 || receipt > 0;
  }
  if (user.role === "OWNER" && user.ownerId) {
    const scope = await getOwnerScope(user as SessionUser & { ownerId: string; organizationId: string });
    const [contractIds, units] = await Promise.all([
      ownedContractIds(scope),
      db.unit.findMany({ where: { organizationId: scope.org, propertyId: { in: scope.propertyIds } }, select: { id: true } }),
    ]);
    const doc = await db.document.count({
      where: {
        organizationId: scope.org,
        url,
        visibility: "OWNER",
        OR: [
          { entityType: "OWNER", entityId: scope.ownerId },
          { entityType: "PROPERTY", entityId: { in: scope.propertyIds } },
          { entityType: "CONTRACT", entityId: { in: contractIds } },
          { entityType: "UNIT", entityId: { in: units.map((u) => u.id) } },
        ],
      },
    });
    return doc > 0;
  }
  return false;
}
