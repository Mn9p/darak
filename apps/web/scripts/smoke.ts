/* Smoke test: signs in as each demo role and GETs every route, reporting non-200s and rendered error pages.
   Needs the demo data: run `pnpm db:reset:demo` first, then start the server.
   Usage: BASE=http://localhost:3111 npx tsx scripts/smoke.ts */
import "./env";
import { db } from "@darak/db";
import { SignJWT } from "jose";

const BASE = process.env.BASE ?? "http://localhost:3000";
const secret = new TextEncoder().encode(process.env.AUTH_SECRET ?? "darak-dev-secret");

// Demo users are identified by their (normalized) login phone — see scripts/seed-demo.ts DEMO_PHONES.
const DEMO = {
  manager: "966500000001",
  pm: "966500000002",
  leasing: "966500000004",
  collector: "966500000005",
  accountant: "966500000007",
  auditor: "966500000009",
  owner: "966500000010",
  tenant: "966500000011",
  admin: "966500000000",
} as const;
const who = (phone: string) => (Object.entries(DEMO).find(([, p]) => p === phone)?.[0] ?? phone);

async function cookieFor(phone: string) {
  const user = await db.user.findUnique({ where: { phone } });
  if (!user) throw new Error("no user " + phone + " (run pnpm db:reset:demo first)");
  const expiresAt = new Date(Date.now() + 3600_000);
  const s = await db.session.create({ data: { userId: user.id, expiresAt, device: "smoke" } });
  const token = await new SignJWT({ sid: s.id, uid: user.id, sa: false }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime(expiresAt).sign(secret);
  return `darak_session=${token}`;
}

async function ids() {
  const org = await db.organization.findFirst({ where: { slug: "aldiyar" } });
  const oid = org!.id;
  const [p, u, o, t, c, i, k, pay, e, st, task, doc, lead, emp, org2] = await Promise.all([
    db.property.findFirst({ where: { organizationId: oid } }),
    db.unit.findFirst({ where: { organizationId: oid, status: "RENTED" } }),
    db.owner.findFirst({ where: { organizationId: oid } }),
    db.tenant.findFirst({ where: { organizationId: oid } }),
    db.contract.findFirst({ where: { organizationId: oid, status: { in: ["ACTIVE", "EXPIRING_SOON"] } } }),
    db.installment.findFirst({ where: { organizationId: oid, status: "OVERDUE" } }),
    db.collectionCase.findFirst({ where: { organizationId: oid } }),
    db.payment.findFirst({ where: { organizationId: oid } }),
    db.expense.findFirst({ where: { organizationId: oid, approvalStatus: "PENDING" } }),
    db.ownerStatement.findFirst({ where: { organizationId: oid } }),
    db.task.findFirst({ where: { organizationId: oid } }),
    db.document.findFirst({ where: { organizationId: oid } }),
    db.lead.findFirst({ where: { organizationId: oid } }),
    db.user.findFirst({ where: { organizationId: oid, role: "COLLECTOR" } }),
    db.organization.findFirst({ where: { slug: "almadar" } }),
  ]);
  // An access request (public "request an account" form) so /admin/requests and the prefilled office form have a row to show.
  const req =
    (await db.accessRequest.findFirst({ where: { status: "NEW" } })) ??
    (await db.accessRequest.create({ data: { name: "سعد الحربي", company: "مكتب الأفق العقاري (smoke)", phone: "966555000111", city: "الرياض", message: "smoke test" } }));
  return { p: p!.id, u: u!.id, o: o!.id, t: t!.id, c: c!.id, i: i!.id, k: k!.id, pay: pay!.id, e: e!.id, st: st!.id, task: task!.id, doc: doc!.id, lead: lead!.id, emp: emp!.id, org2: org2!.id, req: req.id };
}

async function main() {
  const x = await ids();
  const staffRoutes = [
    "/dashboard",
    "/properties", `/properties/${x.p}`, `/properties/${x.p}?tab=units`, `/properties/${x.p}?tab=collections`, `/properties/${x.p}?tab=collections&f=overdue`, `/properties/${x.p}?tab=financials`, `/properties/${x.p}?tab=activity`, "/properties/new", `/properties/${x.p}/edit`,
    "/units", `/units/${x.u}`, `/units/${x.u}?tab=payments`, "/units/new", `/units/${x.u}/edit`,
    "/owners", `/owners/${x.o}`, `/owners/${x.o}?tab=statements`, "/owners/new", `/owners/${x.o}/edit`,
    "/tenants", `/tenants/${x.t}`, `/tenants/${x.t}?tab=collections`, "/tenants/new", `/tenants/${x.t}/edit`,
    "/leasing", "/leasing?view=list", `/leasing/${x.lead}`, "/leasing/new",
    "/contracts", "/contracts?expiring=60", `/contracts/${x.c}`, `/contracts/${x.c}?tab=installments`, `/contracts/${x.c}?tab=renewal`, `/contracts/${x.c}?tab=termination`, "/contracts/new",
    "/installments", `/installments/${x.i}`,
    "/collections", "/collections?view=list", "/collections?view=list&mine=1", `/collections/${x.k}`,
    "/payments", `/payments/${x.pay}`, "/payments/new", `/payments/new?installmentId=${x.i}&tenantId=${x.t}`,
    "/reconciliation", "/reconciliation?tab=UNMATCHED",
    "/expenses", `/expenses/${x.e}`, "/expenses/new", `/expenses/${x.e}/edit`,
    "/statements", `/statements/${x.st}`, `/statements/new?ownerId=${x.o}`,
    "/tasks", "/tasks?view=board&scope=all", `/tasks/${x.task}`, "/tasks/new", `/tasks/${x.task}/edit`,
    "/employees", `/employees/${x.emp}`, `/employees/${x.emp}?tab=kpis`, "/employees/new", `/employees/${x.emp}/edit`,
    "/reports", "/reports/revenue", "/reports/collections", "/reports/aging", "/reports/cashflow", "/reports/expenses", "/reports/property-noi", "/reports/rent-roll", "/reports/occupancy", "/reports/contracts-expiring", "/reports/employee-tasks", "/reports/owner-dues",
    "/search?q=النخيل", "/search?q=الوحدات الشاغرة في الرياض",
    "/audit", "/notifications", "/notifications?tab=rules", "/notifications?tab=templates", "/notifications?tab=preferences",
    "/documents", `/documents/${x.doc}`, "/documents/new",
    "/import", "/import?type=UNITS", "/integrations", "/integrations?tab=logs",
    "/settings", "/settings/organization", "/settings/branches", "/settings/custom-fields", "/settings/security", "/settings/subscription", "/settings/profile",
    "/help", "/help?tab=tickets",
  ];
  const ownerRoutes = ["/owner", "/owner/properties", `/owner/properties/${x.p}`, "/owner/contracts", "/owner/collections", "/owner/expenses", "/owner/statements", `/owner/statements/${x.st}`, "/owner/documents", "/owner/notifications"];
  const tenantRoutes = ["/tenant", "/tenant/contract", "/tenant/payments", "/tenant/documents", "/tenant/notifications"];
  const adminRoutes = ["/admin", "/admin/organizations", `/admin/organizations/${x.org2}`, "/admin/organizations/new", `/admin/organizations/new?requestId=${x.req}`, "/admin/requests", "/admin/requests?status=NEW", "/admin/requests?q=0555", "/admin/subscriptions", "/admin/health", "/admin/support", "/admin/audit"];

  const plan: [string, string[]][] = [
    [DEMO.manager, staffRoutes],
    [DEMO.pm, ["/dashboard", "/properties", `/properties/${x.p}`, "/units", "/tenants", "/contracts", "/tasks", "/collections", "/expenses"]],
    [DEMO.collector, ["/dashboard", "/collections", `/collections/${x.k}`, "/payments", "/tenants", "/installments"]],
    [DEMO.accountant, ["/dashboard", "/payments", "/reconciliation", "/statements", `/statements/${x.st}`, "/expenses", "/reports", "/reports/aging", "/audit"]],
    [DEMO.auditor, ["/dashboard", "/properties", "/contracts", "/audit", "/reports"]],
    [DEMO.leasing, ["/dashboard", "/leasing", "/contracts", "/contracts/new", "/units", "/tenants"]],
    [DEMO.owner, ownerRoutes],
    [DEMO.tenant, tenantRoutes],
    [DEMO.admin, adminRoutes],
  ];

  // Tenant isolation: org1 manager must NOT see org2 records; owner must not see other owner statements
  const org2Prop = await db.property.findFirst({ where: { organizationId: x.org2 } });
  const otherStmt = await db.ownerStatement.findFirst({ where: { ownerId: { not: x.o } } });
  const iso: [string, string][] = [[DEMO.manager, `/properties/${org2Prop!.id}`], [DEMO.owner, `/owner/statements/${otherStmt!.id}`], [DEMO.tenant, "/dashboard"], [DEMO.owner, "/payments"], [DEMO.collector, "/settings/organization"], [DEMO.manager, "/admin/requests"], [DEMO.collector, "/employees"], [DEMO.leasing, "/statements"], [DEMO.pm, "/reports/employee-tasks"]];
  let isoBad = 0;
  for (const [phone, r] of iso) {
    const cookie = await cookieFor(phone);
    const res = await fetch(BASE + r, { headers: { cookie }, redirect: "manual" });
    const body = res.status === 200 ? await res.text() : "";
    // Streaming (loading.tsx) keeps the HTTP status 200 and puts notFound() in the body, so check the body text too.
    const blocked = res.status !== 200 || /السجل غير موجود|لا تملك صلاحية الوصول/.test(body);
    if (!blocked) isoBad++;
    console.log(`${blocked ? "ISOLATED" : "LEAK    "} ${res.status} ${who(phone).padEnd(12)} ${r}`);
  }
  let bad = isoBad;
  // Public + API surface (no cookie)
  const pub: [string, number[]][] = [["/", [200]], ["/login", [200]], ["/privacy", [200]], ["/terms", [200]], ["/api/health", [200]], ["/api/cron/run", [401, 503]], ["/api/files/x/y", [401]], ["/dashboard", [307]]];
  for (const [r, okCodes] of pub) {
    const res = await fetch(BASE + r, { redirect: "manual" });
    const ok = okCodes.includes(res.status);
    if (!ok) bad++;
    console.log(`${ok ? "PUBLIC  " : "PUBBAD  "} ${res.status} ${r}`);
  }
  if (process.env.CRON_SECRET) {
    const res = await fetch(BASE + "/api/cron/run", { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } });
    const ok = res.status === 200;
    if (!ok) bad++;
    console.log(`${ok ? "CRON OK " : "CRONBAD "} ${res.status} /api/cron/run (with secret)`);
  }
  let total = 0;
  for (const [phone, routes] of plan) {
    const cookie = await cookieFor(phone);
    for (const r of routes) {
      total++;
      const t0 = Date.now();
      const res = await fetch(BASE + r, { headers: { cookie }, redirect: "manual" });
      const ms = Date.now() - t0;
      const body = res.status === 200 ? await res.text() : "";
      const errored = /Application error|>حدث خطأ<|Internal Server Error/.test(body);
      const notFound = />السجل غير موجود<|>لا تملك صلاحية الوصول</.test(body);
      const redirectOk = res.status >= 300 && res.status < 400 && (res.headers.get("location") ?? "").startsWith("/") && !/login/.test(res.headers.get("location") ?? "");
      const ok = (res.status === 200 && !errored && !notFound) || redirectOk;
      if (!ok) bad++;
      const flag = ok ? "OK " : "BAD";
      if (!ok || process.env.VERBOSE) console.log(`${flag} ${res.status} ${String(ms).padStart(5)}ms ${who(phone).padEnd(12)} ${r}${errored ? "  <-- error page" : ""}${notFound ? "  <-- not found" : ""}${res.status >= 300 && res.status < 400 ? "  -> " + res.headers.get("location") : ""}`);
    }
  }
  console.log(`\n${total - bad}/${total} routes OK`);
  process.exit(bad ? 1 : 0);
}

main().finally(() => db.$disconnect());
