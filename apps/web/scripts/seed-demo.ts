/* eslint-disable no-console */
// Demo data for local testing only. Run: pnpm db:seed:demo
// Creates two demo offices with owners, properties, units, tenants, contracts, payments and collection cases.
// Every demo user signs in with a phone number from DEMO_PHONES (the SMS code is printed in the dev console).
import "./env";
import { PRESETS } from "../src/lib/permissions";
import { db } from "@darak/db";
import { buildSchedule, runEngine } from "../src/lib/engine";
import { addDays, addMonths } from "../src/lib/format";

/** Demo employee: role EMPLOYEE with a permission preset (same presets the team screen offers). */
const employee = (key: string) => {
  const p = PRESETS.find((x) => x.key === key)!;
  return { role: "EMPLOYEE", permissions: JSON.stringify(p.permissions), allProperties: p.allProperties };
};


// deterministic PRNG
let seed = 42;
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};
const pick = <T,>(arr: T[]): T => arr[Math.floor(rnd() * arr.length)];
const between = (a: number, b: number) => Math.floor(a + rnd() * (b - a + 1));
const today = new Date();
today.setHours(0, 0, 0, 0);
const d = (days: number) => addDays(today, days);

const FIRST = ["أحمد", "محمد", "خالد", "سعود", "فهد", "عبدالله", "نواف", "تركي", "بندر", "سلطان", "ماجد", "يوسف", "عبدالعزيز", "فيصل", "ناصر", "سعد", "راكان", "مشعل", "طلال", "عمر"];
const LAST = ["العتيبي", "القحطاني", "الشمري", "الدوسري", "الحربي", "المطيري", "الغامدي", "الزهراني", "السبيعي", "العنزي", "الشهري", "البقمي", "المالكي", "الجهني", "الرشيدي"];
const COMPANIES = ["شركة نماء للتجارة", "مؤسسة الأفق للمقاولات", "شركة روافد الطبية", "مؤسسة الديار للتقنية", "شركة سما للأغذية", "مكتب المهندس للاستشارات"];
const name = () => `${pick(FIRST)} ${pick(FIRST)} ${pick(LAST)}`;
const phone = () => `05${between(0, 9)}${String(between(1000000, 9999999))}`;
// Deterministic demo login phones (stored normalized 9665XXXXXXXX). Random phone() values start at 05X1000000, so they never collide.
const DEMO_PHONES = {
  admin: "966500000000",
  manager: "966500000001",
  pm: "966500000002",
  pm2: "966500000003",
  leasing: "966500000004",
  collector: "966500000005",
  collector2: "966500000006",
  accountant: "966500000007",
  auditor: "966500000009",
  owner: "966500000010",
  tenant: "966500000011",
  sami: "966500000020",
} as const;
const nid = () => `1${String(between(100000000, 999999999))}`;
const iban = () => `SA${String(between(10, 99))}80000${String(between(100000000000000, 999999999999999))}`;

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  if (!url.startsWith("file:") && process.env.ALLOW_DEMO_SEED !== "1") {
    console.error("demo seed refused on non-SQLite database");
    process.exit(1);
  }
  console.log("🌱 Seeding DARAK demo data…");

  // ── Platform admin (no org) ──
  await db.user.create({ data: { name: "فريق دارك", phone: DEMO_PHONES.admin, email: "admin@darak.sa", role: "SUPER_ADMIN", jobTitle: "Platform Admin" } });

  // ── Organization ──
  const org = await db.organization.create({
    data: {
      name: "مكتب الديار لإدارة الأملاك",
      slug: "aldiyar",
      crNumber: "1010456789",
      vatNumber: "300012345600003",
      phone: "0112345678",
      email: "info@aldiyar.sa",
      city: "الرياض",
      plan: "PROFESSIONAL",
      status: "ACTIVE",
      unitsLimit: 500,
      usersLimit: 25,
      renewalDate: addMonths(today, 7),
      settings: JSON.stringify({ graceDays: 3, dueSoonDays: 7, autoApproveLimit: 500, managerApprovalLimit: 5000, vatRate: 15 }),
      onboarding: JSON.stringify({ company: true, branches: true, employees: true, permissions: true, owners: true, properties: true, units: true, contracts: true, integrations: true, review: false, live: false }),
    },
  });
  const oid = org.id;

  // second org for tenant isolation
  const org2 = await db.organization.create({ data: { name: "مكتب المدار العقاري", slug: "almadar", city: "جدة", plan: "STARTER", status: "TRIAL", unitsLimit: 100, usersLimit: 5, renewalDate: addDays(today, 21) } });
  await db.user.create({ data: { organizationId: org2.id, name: "سامي الحارثي", phone: DEMO_PHONES.sami, email: "sami@almadar.sa", role: "ACCOUNT_OWNER" } });
  const p2 = await db.property.create({ data: { organizationId: org2.id, code: "PRP-0001", name: "عمارة المدار", type: "RESIDENTIAL_BUILDING", city: "جدة", district: "الروضة" } });
  await db.unit.createMany({ data: [1, 2, 3].map((n) => ({ organizationId: org2.id, propertyId: p2.id, code: `UNT-000${n}`, number: `${n}`, type: "APARTMENT", status: "VACANT", targetRent: 30000 })) });

  // ── Branches ──
  const riyadh = await db.branch.create({ data: { organizationId: oid, name: "الفرع الرئيسي — الرياض", city: "الرياض", isMain: true, phone: "0112345678" } });
  const jeddah = await db.branch.create({ data: { organizationId: oid, name: "فرع جدة", city: "جدة", phone: "0126543210" } });

  // ── Users ──
  const manager = await db.user.create({ data: { organizationId: oid, branchId: riyadh.id, name: "عبدالرحمن الديار", email: "manager@darak.sa", role: "ACCOUNT_OWNER", employeeCode: "EMP-001", department: "الإدارة", jobTitle: "صاحب المكتب", phone: DEMO_PHONES.manager } });
  const pm = await db.user.create({ data: { organizationId: oid, branchId: riyadh.id, name: "سلمان القحطاني", email: "pm@darak.sa", ...employee("PROPERTY"), employeeCode: "EMP-002", department: "التشغيل", jobTitle: "مدير عقارات", managerId: manager.id, phone: DEMO_PHONES.pm } });
  const pm2 = await db.user.create({ data: { organizationId: oid, branchId: jeddah.id, name: "هاني الزهراني", email: "pm2@darak.sa", ...employee("PROPERTY"), employeeCode: "EMP-003", department: "التشغيل", jobTitle: "مدير عقارات — جدة", managerId: manager.id, phone: DEMO_PHONES.pm2 } });
  const leasing = await db.user.create({ data: { organizationId: oid, branchId: riyadh.id, name: "نورة العتيبي", email: "leasing@darak.sa", ...employee("LEASING"), employeeCode: "EMP-004", department: "التأجير", jobTitle: "مسؤولة تأجير", managerId: manager.id, phone: DEMO_PHONES.leasing } });
  const collector = await db.user.create({ data: { organizationId: oid, branchId: riyadh.id, name: "فهد الشمري", email: "collector@darak.sa", ...employee("COLLECTION"), employeeCode: "EMP-005", department: "التحصيل", jobTitle: "محصل", managerId: manager.id, phone: DEMO_PHONES.collector } });
  const collector2 = await db.user.create({ data: { organizationId: oid, branchId: riyadh.id, name: "ريم الدوسري", email: "collector2@darak.sa", ...employee("COLLECTION"), employeeCode: "EMP-006", department: "التحصيل", jobTitle: "محصلة أولى", managerId: manager.id, phone: DEMO_PHONES.collector2 } });
  const accountant = await db.user.create({ data: { organizationId: oid, branchId: riyadh.id, name: "ماجد الحربي", email: "accountant@darak.sa", ...employee("ACCOUNTING"), employeeCode: "EMP-007", department: "المالية", jobTitle: "محاسب", managerId: manager.id, phone: DEMO_PHONES.accountant } });
  const auditor = await db.user.create({ data: { organizationId: oid, branchId: riyadh.id, name: "لمى السبيعي", email: "auditor@darak.sa", ...employee("READONLY"), employeeCode: "EMP-009", department: "المراجعة", jobTitle: "مدققة داخلية", phone: DEMO_PHONES.auditor } });
  const staff = [manager, pm, pm2, leasing, collector, collector2, accountant, auditor];

  // ── Owners ──
  const ownersData = [
    { type: "INDIVIDUAL", name: "محمد بن سعود العنزي", fee: 5, tags: "VIP Owner" },
    { type: "INDIVIDUAL", name: "خالد عبدالله الغامدي", fee: 6 },
    { type: "COMPANY", name: "شركة الوسام للاستثمار العقاري", fee: 4, rep: "م. بدر الوسام", cr: "1010789012", vat: "300098765400003" },
    { type: "INDIVIDUAL", name: "سارة فهد الرشيدي", fee: 5 },
    { type: "COMPANY", name: "صندوق الأمانة الوقفي", fee: 3.5, rep: "أ. ناصر الجهني", cr: "4030112233", vat: "300055443300003" },
    { type: "INDIVIDUAL", name: "عبدالعزيز مشعل البقمي", fee: 7, tags: "Legal Follow-up" },
  ];
  const owners = [];
  for (let i = 0; i < ownersData.length; i++) {
    const o = ownersData[i];
    owners.push(
      await db.owner.create({
        data: {
          organizationId: oid,
          code: `OWN-${String(i + 1).padStart(4, "0")}`,
          type: o.type,
          name: o.name,
          nationalId: o.type === "INDIVIDUAL" ? nid() : null,
          crNumber: o.cr ?? null,
          vatNumber: o.vat ?? null,
          representative: o.rep ?? null,
          phone: i === 0 ? DEMO_PHONES.owner : phone(), // the owner portal user signs in with owners[0].phone
          email: `owner${i + 1}@mail.sa`,
          nationality: "سعودي",
          address: `${pick(["الرياض", "جدة"])} — حي ${pick(["النرجس", "الملقا", "الروضة", "الياسمين"])}`,
          iban: iban(),
          bankName: pick(["مصرف الراجحي", "البنك الأهلي", "بنك الرياض", "مصرف الإنماء"]),
          managementFeePct: o.fee,
          agreementTerms: "عقد إدارة أملاك سنوي متجدد. تُخصم أتعاب الإدارة من الإيجار المحصل. المصروفات تُعتمد مسبقًا فوق 5,000 ريال.",
          managementStartDate: addMonths(today, -between(6, 36)),
          accountManagerId: i % 2 === 0 ? pm.id : manager.id,
          tags: o.tags ?? "",
        },
      }),
    );
  }
  await db.user.create({ data: { organizationId: oid, name: owners[0].name, phone: DEMO_PHONES.owner, email: "owner@darak.sa", role: "OWNER", ownerId: owners[0].id } });

  // ── Properties ──
  const propsData = [
    { name: "برج النخيل السكني", type: "RESIDENTIAL_BUILDING", city: "الرياض", district: "النرجس", units: 20, prefix: "A", floors: 5, rent: [28000, 45000], owner: [0], mgr: pm.id, branch: riyadh.id, tags: "Premium Property" },
    { name: "عمارة الياسمين", type: "RESIDENTIAL_BUILDING", city: "الرياض", district: "الياسمين", units: 12, prefix: "B", floors: 3, rent: [25000, 38000], owner: [1], mgr: pm.id, branch: riyadh.id },
    { name: "مجمع الوسام التجاري", type: "COMMERCIAL_BUILDING", city: "الرياض", district: "العليا", units: 10, prefix: "S", floors: 2, rent: [60000, 140000], owner: [2], mgr: manager.id, branch: riyadh.id, usage: "COMMERCIAL", utype: "SHOP" },
    { name: "فلل الملقا", type: "COMPOUND", city: "الرياض", district: "الملقا", units: 6, prefix: "V", floors: 2, rent: [90000, 130000], owner: [3, 0], split: [60, 40], mgr: pm.id, branch: riyadh.id, utype: "VILLA" },
    { name: "مكاتب الأمانة", type: "OFFICES", city: "الرياض", district: "الملك فهد", units: 8, prefix: "O", floors: 4, rent: [55000, 95000], owner: [4], mgr: manager.id, branch: riyadh.id, usage: "COMMERCIAL", utype: "OFFICE" },
    { name: "عمارة الروضة — جدة", type: "RESIDENTIAL_BUILDING", city: "جدة", district: "الروضة", units: 10, prefix: "R", floors: 4, rent: [24000, 36000], owner: [5], mgr: pm2.id, branch: jeddah.id },
    { name: "مستودعات الخمرة", type: "WAREHOUSE", city: "جدة", district: "الخمرة", units: 4, prefix: "W", floors: 1, rent: [80000, 120000], owner: [2], mgr: pm2.id, branch: jeddah.id, usage: "COMMERCIAL", utype: "WAREHOUSE" },
    { name: "أرض حي القيروان", type: "LAND", city: "الرياض", district: "القيروان", units: 0, prefix: "L", floors: 0, rent: [0, 0], owner: [1], mgr: pm.id, branch: riyadh.id },
  ];
  const properties = [];
  const units: { id: string; propertyId: string; number: string; rent: number; propIdx: number; ownerIdx: number }[] = [];
  let unitSeq = 0;
  for (let i = 0; i < propsData.length; i++) {
    const p = propsData[i];
    const prop = await db.property.create({
      data: {
        organizationId: oid,
        branchId: p.branch,
        managerId: p.mgr,
        code: `PRP-${String(i + 1).padStart(4, "0")}`,
        name: p.name,
        type: p.type,
        city: p.city,
        district: p.district,
        street: `شارع ${pick(["الأمير سلطان", "العليا", "الملك عبدالعزيز", "التحلية", "أنس بن مالك"])}`,
        nationalAddress: `${between(1000, 9999)} ${p.district} ${between(10000, 99999)}`,
        deedNumber: `${between(310000000000, 399999999999)}`,
        landArea: between(600, 3000),
        buildingArea: p.units ? between(1200, 8000) : null,
        floors: p.floors || null,
        buildYear: between(2005, 2022),
        status: "ACTIVE",
        tags: p.tags ?? "",
        lat: 24.7 + rnd() * 0.2,
        lng: 46.6 + rnd() * 0.2,
      },
    });
    properties.push(prop);
    for (let k = 0; k < p.owner.length; k++) {
      await db.propertyOwnership.create({ data: { propertyId: prop.id, ownerId: owners[p.owner[k]].id, percentage: p.split ? p.split[k] : 100, startDate: addMonths(today, -24) } });
    }
    for (let u = 1; u <= p.units; u++) {
      unitSeq++;
      const rent = between(p.rent[0] / 1000, p.rent[1] / 1000) * 1000;
      const floor = p.floors ? String(Math.ceil(u / Math.ceil(p.units / p.floors))) : "1";
      const unit = await db.unit.create({
        data: {
          organizationId: oid,
          propertyId: prop.id,
          code: `UNT-${String(unitSeq).padStart(4, "0")}`,
          number: `${p.prefix}-${String(u).padStart(2, "0")}`,
          floor,
          type: p.utype ?? (rnd() < 0.15 ? "STUDIO" : "APARTMENT"),
          usage: p.usage ?? "RESIDENTIAL",
          area: between(60, 350),
          rooms: p.usage === "COMMERCIAL" ? null : between(1, 5),
          bathrooms: between(1, 4),
          targetRent: rent,
          currentRent: null,
          status: "VACANT",
        },
      });
      units.push({ id: unit.id, propertyId: prop.id, number: unit.number, rent, propIdx: i, ownerIdx: p.owner[0] });
    }
  }
  // assignments: pm -> 4 riyadh residential, pm2 -> jeddah
  for (const pi of [0, 1, 3, 7]) await db.propertyAssignment.create({ data: { userId: pm.id, propertyId: properties[pi].id } });
  for (const pi of [5, 6]) await db.propertyAssignment.create({ data: { userId: pm2.id, propertyId: properties[pi].id } });

  // ── Tenants ──
  const tenants = [];
  const tenantCount = 52;
  for (let i = 0; i < tenantCount; i++) {
    const isCompany = rnd() < 0.2;
    tenants.push(
      await db.tenant.create({
        data: {
          organizationId: oid,
          code: `TNT-${String(i + 1).padStart(4, "0")}`,
          type: isCompany ? "COMPANY" : "INDIVIDUAL",
          name: i === 0 ? "أحمد سعد الحربي" : isCompany ? pick(COMPANIES) + ` (${i})` : name(),
          nationalId: isCompany ? null : nid(),
          idExpiry: isCompany ? null : addDays(today, between(-20, 900)),
          crNumber: isCompany ? `10${between(10000000, 99999999)}` : null,
          vatNumber: isCompany ? `3000${between(10000000000, 99999999999)}` : null,
          representative: isCompany ? name() : null,
          phone: i === 0 ? DEMO_PHONES.tenant : phone(), // the tenant portal user signs in with tenants[0].phone
          email: `tenant${i + 1}@mail.sa`,
          employer: isCompany ? null : pick(["أرامكو", "سابك", "وزارة التعليم", "STC", "قطاع خاص", "الخطوط السعودية", null]),
          altContactName: rnd() < 0.5 ? name() : null,
          altContactPhone: rnd() < 0.5 ? phone() : null,
          riskLevel: rnd() < 0.12 ? "HIGH" : rnd() < 0.3 ? "MEDIUM" : "LOW",
          tags: rnd() < 0.1 ? "High Risk Tenant" : "",
        },
      }),
    );
  }
  await db.user.create({ data: { organizationId: oid, name: tenants[0].name, phone: DEMO_PHONES.tenant, email: "tenant@darak.sa", role: "TENANT", tenantId: tenants[0].id } });

  // ── Contracts + installments + payments ──
  const rentable = units.filter((u) => u.propIdx !== 7);
  let cSeq = 0;
  let paySeq = 0;
  const contracts: { id: string; unitId: string; tenantId: string; code: string; propIdx: number }[] = [];
  const paymentsForBank: { id: string; amount: number; paidAt: Date; ref: string; tenant: string }[] = [];

  // 78% occupancy
  const toRent = rentable.slice().sort(() => rnd() - 0.5).slice(0, Math.round(rentable.length * 0.78));
  let tIdx = 0;
  const specialStarts = [ -345, -320, -300, -280, -275, -260, -240, -220, -200, -180, -150, -120, -100, -90, -60, -40, -20, -10 ]; // variety; contract length 12 months => end in 20..355 days
  for (let i = 0; i < toRent.length; i++) {
    const u = toRent[i];
    const tenant = tenants[tIdx++ % tenants.length];
    const startOffset = i < specialStarts.length ? specialStarts[i] : -between(15, 350);
    const start = d(startOffset);
    const end = addDays(addMonths(start, 12), -1);
    const freq = u.rent >= 60000 ? pick(["QUARTERLY", "SEMI_ANNUAL", "ANNUAL"]) : pick(["MONTHLY", "QUARTERLY", "QUARTERLY", "SEMI_ANNUAL"]);
    const schedule = buildSchedule({ startDate: start, totalAmount: u.rent, frequency: freq });
    cSeq++;
    const code = `CNT-${String(cSeq).padStart(4, "0")}`;
    const c = await db.contract.create({
      data: {
        organizationId: oid,
        code,
        propertyId: u.propertyId,
        unitId: u.id,
        tenantId: tenant.id,
        ownerId: owners[u.ownerIdx].id,
        startDate: start,
        endDate: end,
        totalAmount: u.rent,
        managementFeePct: owners[u.ownerIdx].managementFeePct,
        vatAmount: propsData[u.propIdx].usage === "COMMERCIAL" ? Math.round(u.rent * 0.15) : 0,
        paymentFrequency: freq,
        installmentsCount: schedule.length,
        status: "ACTIVE",
        createdById: leasing.id,
        createdAt: addDays(start, -between(3, 20)),
      },
    });
    contracts.push({ id: c.id, unitId: u.id, tenantId: tenant.id, code, propIdx: u.propIdx });
    await db.unit.update({ where: { id: u.id }, data: { status: "RENTED", currentRent: u.rent } });

    // installments & payments
    const tenantRisk = tenant.riskLevel;
    for (const s of schedule) {
      const inst = await db.installment.create({
        data: { organizationId: oid, contractId: c.id, tenantId: tenant.id, seq: s.seq, dueDate: s.dueDate, amount: s.amount, status: "UPCOMING" },
      });
      const daysPast = Math.round((today.getTime() - s.dueDate.getTime()) / 86400000);
      if (daysPast > 0) {
        // decide payment behaviour
        const r = rnd();
        const payProb = tenantRisk === "HIGH" ? 0.45 : tenantRisk === "MEDIUM" ? 0.75 : 0.92;
        if (r < payProb || daysPast > 120) {
          // full payment (late by 0-15 days)
          paySeq++;
          const paidAt = addDays(s.dueDate, between(-5, tenantRisk === "LOW" ? 5 : 20));
          const pcode = `PAY-${String(paySeq).padStart(4, "0")}`;
          const ref = `TRF${between(100000000, 999999999)}`;
          const pay = await db.payment.create({
            data: { organizationId: oid, code: pcode, tenantId: tenant.id, contractId: c.id, paidAt, amount: s.amount, method: pick(["BANK_TRANSFER", "BANK_TRANSFER", "BANK_TRANSFER", "CARD", "CASH"]), reference: ref, bank: pick(["الراجحي", "الأهلي", "الرياض", "الإنماء"]), status: rnd() < 0.8 ? "APPROVED" : "RECORDED", reconciliationStatus: rnd() < 0.8 ? "MATCHED" : "UNMATCHED", recordedById: pick([collector.id, accountant.id]) },
          });
          await db.paymentAllocation.create({ data: { paymentId: pay.id, installmentId: inst.id, amount: s.amount } });
          await db.installment.update({ where: { id: inst.id }, data: { paidAmount: s.amount, status: "PAID" } });
          paymentsForBank.push({ id: pay.id, amount: s.amount, paidAt, ref, tenant: tenant.name });
        } else if (r < payProb + 0.2 && daysPast > 5) {
          // partial payment
          paySeq++;
          const part = Math.round(s.amount * pick([0.3, 0.5, 0.66]) / 100) * 100;
          const paidAt = addDays(s.dueDate, between(1, Math.min(daysPast, 25)));
          const pcode = `PAY-${String(paySeq).padStart(4, "0")}`;
          const ref = `TRF${between(100000000, 999999999)}`;
          const pay = await db.payment.create({
            data: { organizationId: oid, code: pcode, tenantId: tenant.id, contractId: c.id, paidAt, amount: part, method: "BANK_TRANSFER", reference: ref, bank: "الراجحي", status: "APPROVED", reconciliationStatus: "MATCHED", recordedById: collector.id },
          });
          await db.paymentAllocation.create({ data: { paymentId: pay.id, installmentId: inst.id, amount: part } });
          await db.installment.update({ where: { id: inst.id }, data: { paidAmount: part, status: "PARTIALLY_PAID" } });
          paymentsForBank.push({ id: pay.id, amount: part, paidAt, ref, tenant: tenant.name });
        }
        // else: unpaid -> engine will mark OVERDUE and open case
      }
    }
  }

  // Expired / renewed / terminated / drafts
  const vacantUnits = rentable.filter((u) => !toRent.includes(u));
  // 2 expired contracts (history) on vacant units
  for (let i = 0; i < 2 && i < vacantUnits.length; i++) {
    const u = vacantUnits[i];
    const t = tenants[tIdx++ % tenants.length];
    cSeq++;
    const start = addMonths(today, -16);
    const end = addDays(addMonths(start, 12), -1);
    const c = await db.contract.create({ data: { organizationId: oid, code: `CNT-${String(cSeq).padStart(4, "0")}`, propertyId: u.propertyId, unitId: u.id, tenantId: t.id, ownerId: owners[u.ownerIdx].id, startDate: start, endDate: end, totalAmount: u.rent, paymentFrequency: "SEMI_ANNUAL", installmentsCount: 2, status: "EXPIRED", createdById: leasing.id } });
    for (const s of buildSchedule({ startDate: start, totalAmount: u.rent, frequency: "SEMI_ANNUAL" })) {
      await db.installment.create({ data: { organizationId: oid, contractId: c.id, tenantId: t.id, seq: s.seq, dueDate: s.dueDate, amount: s.amount, paidAmount: s.amount, status: "PAID" } });
    }
  }
  // 1 terminated
  if (vacantUnits[2]) {
    const u = vacantUnits[2];
    const t = tenants[tIdx++ % tenants.length];
    cSeq++;
    const start = addMonths(today, -8);
    await db.contract.create({ data: { organizationId: oid, code: `CNT-${String(cSeq).padStart(4, "0")}`, propertyId: u.propertyId, unitId: u.id, tenantId: t.id, ownerId: owners[u.ownerIdx].id, startDate: start, endDate: addDays(addMonths(start, 12), -1), totalAmount: u.rent, paymentFrequency: "QUARTERLY", installmentsCount: 4, status: "TERMINATED", terminationDate: addMonths(today, -2), terminationReason: "انتقال المستأجر لمدينة أخرى — إنهاء بالتراضي", finalSettlement: "تم خصم 1,500 ريال من التأمين مقابل إصلاحات، وإعادة المتبقي.", createdById: leasing.id } });
  }
  // 2 drafts / pending
  for (let i = 3; i < 5 && i < vacantUnits.length; i++) {
    const u = vacantUnits[i];
    const t = tenants[tIdx++ % tenants.length];
    cSeq++;
    const start = d(between(3, 20));
    await db.contract.create({ data: { organizationId: oid, code: `CNT-${String(cSeq).padStart(4, "0")}`, propertyId: u.propertyId, unitId: u.id, tenantId: t.id, ownerId: owners[u.ownerIdx].id, startDate: start, endDate: addDays(addMonths(start, 12), -1), totalAmount: u.rent, paymentFrequency: "QUARTERLY", installmentsCount: 4, status: i === 3 ? "PENDING_APPROVAL" : "DRAFT", createdById: leasing.id } });
    await db.unit.update({ where: { id: u.id }, data: { status: "RESERVED" } });
  }
  // some vacant units flagged available / under maintenance
  for (let i = 5; i < vacantUnits.length; i++) {
    const st = i % 5 === 0 ? "UNDER_MAINTENANCE" : i % 3 === 0 ? "AVAILABLE" : "VACANT";
    await db.unit.update({ where: { id: vacantUnits[i].id }, data: { status: st } });
  }

  // ── Leads ──
  const leadStages = ["LEAD", "VIEWING", "NEGOTIATION", "APPLICATION", "APPROVED", "CONTRACTING", "LEAD", "VIEWING", "LOST", "VIEWING"];
  for (let i = 0; i < 10; i++) {
    const u = pick(vacantUnits);
    await db.lead.create({
      data: {
        organizationId: oid,
        unitId: u.id,
        name: name(),
        phone: phone(),
        source: pick(["WALK_IN", "PHONE", "WEBSITE", "REFERRAL", "AQAR", "HARAJ"]),
        stage: leadStages[i],
        viewingDate: ["VIEWING", "NEGOTIATION", "APPLICATION"].includes(leadStages[i]) ? d(between(-3, 6)) : null,
        offerAmount: ["NEGOTIATION", "APPLICATION", "APPROVED", "CONTRACTING"].includes(leadStages[i]) ? u.rent - between(0, 4) * 1000 : null,
        assignedToId: leasing.id,
        lostReason: leadStages[i] === "LOST" ? "السعر أعلى من الميزانية" : null,
        createdAt: d(-between(1, 25)),
      },
    });
  }

  // ── Expenses ──
  const payees = ["مؤسسة النور للكهرباء","شركة التبريد المتقدم","مؤسسة السباك الماهر","شركة نظافة الديار","مصاعد الخليج"];
  const expCats = ["MAINTENANCE", "ELECTRICITY", "WATER", "CLEANING", "SECURITY", "FEES", "SERVICES", "MAINTENANCE", "MAINTENANCE", "OTHER"];
  const expDesc: Record<string, string[]> = {
    MAINTENANCE: ["إصلاح مضخة المياه", "استبدال وحدة تكييف", "صيانة المصعد الدورية", "إصلاح تسريب سباكة", "دهان المدخل"],
    ELECTRICITY: ["فاتورة الكهرباء — الشهر الحالي", "فاتورة كهرباء المناطق المشتركة"],
    WATER: ["فاتورة المياه"],
    CLEANING: ["عقد النظافة الشهري"],
    SECURITY: ["حراسة أمنية — شهري"],
    FEES: ["رسوم بلدية", "رسوم تجديد رخصة"],
    SERVICES: ["مكافحة حشرات", "صيانة خزانات"],
    OTHER: ["مصروفات نثرية"],
  };
  for (let i = 0; i < 34; i++) {
    const p = properties[i % 7];
    const cat = pick(expCats);
    const amount = cat === "MAINTENANCE" ? between(3, 90) * 100 : cat === "CLEANING" || cat === "SECURITY" ? between(20, 60) * 100 : between(2, 30) * 100;
    const date = d(-between(0, 75));
    const auto = amount <= 500;
    const approval = auto ? "APPROVED" : i % 4 === 0 ? "PENDING" : i % 9 === 0 ? "REJECTED" : "APPROVED";
    const ownership = propsData[i % 7].owner[0];
    await db.expense.create({
      data: {
        organizationId: oid,
        code: `EXP-${String(i + 1).padStart(4, "0")}`,
        propertyId: p.id,
        ownerId: owners[ownership].id,
        payee: cat === "MAINTENANCE" || cat === "CLEANING" ? pick(payees) : null,
        category: cat,
        description: pick(expDesc[cat]),
        amount,
        vatAmount: Math.round(amount * 0.15),
        date,
        invoiceNumber: `INV-${between(10000, 99999)}`,
        method: pick(["BANK_TRANSFER", "CASH", "CARD"]),
        approvalStatus: approval,
        approvedById: approval === "APPROVED" ? (auto ? null : manager.id) : null,
        approvedAt: approval === "APPROVED" ? addDays(date, 1) : null,
        createdById: pick([pm.id, accountant.id]),
        notes: auto ? "اعتماد تلقائي حسب السياسة (أقل من 500 ريال)" : null,
        createdAt: date,
      },
    });
  }

  // ── Manual tasks ──
  const tData = [
    ["مراجعة عقد إدارة مالك الوسام قبل التجديد", manager.id, "HIGH", 5, "OWNER", owners[2].id, owners[2].name],
    ["تحديث صور الوحدات الشاغرة في برج النخيل", leasing.id, "MEDIUM", 3, "PROPERTY", properties[0].id, properties[0].name],
    ["إرسال تقرير المالك الشهري", accountant.id, "HIGH", -2, "OWNER", owners[0].id, owners[0].name],
    ["زيارة ميدانية — مجمع الوسام التجاري", pm.id, "MEDIUM", 1, "PROPERTY", properties[2].id, properties[2].name],
    ["تجهيز عرض تأجير للمستودعات الشاغرة", leasing.id, "LOW", 10, "PROPERTY", properties[6].id, properties[6].name],
    ["مطابقة كشف حساب الراجحي — الشهر الماضي", accountant.id, "URGENT", -1, null, null, null],
  ];
  for (const t of tData) {
    await db.task.create({ data: { organizationId: oid, title: t[0] as string, assignedToId: t[1] as string, createdById: manager.id, priority: t[2] as string, status: (t[3] as number) < 0 ? "IN_PROGRESS" : "ASSIGNED", dueDate: d(t[3] as number), entityType: (t[4] as string) ?? null, entityId: (t[5] as string) ?? null, entityLabel: (t[6] as string) ?? null, checklist: JSON.stringify([{ text: "جمع البيانات", done: true }, { text: "المراجعة", done: false }]) } });
  }
  await db.task.create({ data: { organizationId: oid, title: "تحديث بيانات التواصل للمستأجرين", assignedToId: collector2.id, createdById: manager.id, priority: "LOW", status: "COMPLETED", completedAt: d(0), dueDate: d(0) } });

  // ── Documents ──
  const docs = [
    ["صك الملكية — برج النخيل", "DEED", "PROPERTY", properties[0].id, properties[0].name, null],
    ["السجل التجاري — شركة الوسام", "CR", "OWNER", owners[2].id, owners[2].name, d(25)],
    ["هوية المالك — محمد العنزي", "ID", "OWNER", owners[0].id, owners[0].name, d(400)],
    ["عقد إدارة أملاك — صندوق الأمانة", "CONTRACT", "OWNER", owners[4].id, owners[4].name, d(60)],
    ["رخصة البلدية — مجمع الوسام", "OTHER", "PROPERTY", properties[2].id, properties[2].name, d(-5)],
    ["شهادة سلامة المصعد — برج النخيل", "OTHER", "PROPERTY", properties[0].id, properties[0].name, d(85)],
    ["عقد إيجار موقع — CNT-0001", "CONTRACT", "CONTRACT", contracts[0].id, contracts[0].code, null],
    ["هوية المستأجر — أحمد الحربي", "ID", "TENANT", tenants[0].id, tenants[0].name, d(300)],
    ["فاتورة صيانة المصعد", "INVOICE", "EXPENSE", null, "EXP-0003", null],
    ["صور الوحدة A-05 قبل التسليم", "PHOTO", "UNIT", units[4].id, units[4].number, null],
    ["وثيقة تأمين المبنى — عمارة الياسمين", "OTHER", "PROPERTY", properties[1].id, properties[1].name, d(150)],
  ];
  for (const dd of docs) {
    await db.document.create({ data: { organizationId: oid, name: dd[0] as string, type: dd[1] as string, entityType: dd[2] as string, entityId: (dd[3] as string) ?? null, entityLabel: dd[4] as string, issueDate: d(-between(30, 400)), expiryDate: (dd[5] as Date) ?? null, uploadedById: pick([pm.id, leasing.id, accountant.id]), tags: "", visibility: dd[2] === "TENANT" || dd[2] === "CONTRACT" ? "TENANT" : dd[2] === "OWNER" || dd[2] === "PROPERTY" ? "OWNER" : "INTERNAL", url: "#", sizeKb: between(80, 4200), createdAt: d(-between(1, 200)) } });
  }

  // ── Notification templates & rules ──
  await db.notificationTemplate.createMany({
    data: [
      { organizationId: oid, name: "تذكير استحقاق دفعة", event: "INSTALLMENT_DUE", channel: "SMS", body: "مرحبًا {{tenant_name}}، نود تذكيركم باستحقاق دفعة عقد الوحدة {{unit_number}} بقيمة {{amount}} ريال بتاريخ {{due_date}}. — دارك" },
      { organizationId: oid, name: "تنبيه تأخر دفعة", event: "INSTALLMENT_OVERDUE", channel: "WHATSAPP", body: "عزيزنا {{tenant_name}}، تجاوزت دفعة الوحدة {{unit_number}} بقيمة {{amount}} ريال تاريخ استحقاقها ({{due_date}}). يرجى السداد أو التواصل معنا." },
      { organizationId: oid, name: "اقتراب انتهاء عقد", event: "CONTRACT_EXPIRING", channel: "EMAIL", body: "ينتهي عقد الوحدة {{unit_number}} بتاريخ {{end_date}}. يرجى إبلاغنا برغبتكم في التجديد." },
      { organizationId: oid, name: "تأكيد استلام دفعة", event: "PAYMENT_RECEIVED", channel: "SMS", body: "تم استلام دفعتكم بقيمة {{amount}} ريال للوحدة {{unit_number}}. شكرًا لكم. — دارك" },
    ],
  });
  await db.notificationRule.createMany({
    data: [
      { organizationId: oid, name: "تنبيه انتهاء عقد — 90 يوم", event: "CONTRACT_EXPIRING", daysBefore: 90, channels: "IN_APP", targetRoles: "EMPLOYEE" },
      { organizationId: oid, name: "مهمة متابعة تجديد — 60 يوم", event: "CONTRACT_EXPIRING", daysBefore: 60, channels: "IN_APP,EMAIL", targetRoles: "EMPLOYEE", createTask: true },
      { organizationId: oid, name: "تصعيد انتهاء عقد — 30 يوم", event: "CONTRACT_EXPIRING", daysBefore: 30, channels: "IN_APP,EMAIL", targetRoles: "ACCOUNT_OWNER" },
      { organizationId: oid, name: "تذكير المستأجر قبل الاستحقاق", event: "INSTALLMENT_DUE", daysBefore: 7, channels: "SMS,WHATSAPP", targetRoles: "TENANT" },
      { organizationId: oid, name: "فتح مطالبة عند التأخر", event: "INSTALLMENT_OVERDUE", daysBefore: 0, channels: "IN_APP", targetRoles: "EMPLOYEE", createTask: true },
      { organizationId: oid, name: "وعد سداد مكسور", event: "BROKEN_PROMISE", daysBefore: 0, channels: "IN_APP", targetRoles: "EMPLOYEE,ACCOUNT_OWNER", createTask: true },
      { organizationId: oid, name: "انتهاء مستند", event: "DOCUMENT_EXPIRING", daysBefore: 30, channels: "IN_APP", targetRoles: "ACCOUNT_OWNER", createTask: true },
    ],
  });

  // ── Integrations ──
  await db.integration.create({ data: { organizationId: oid, provider: "WHATSAPP", name: "WhatsApp Business", status: "CONNECTED", lastSyncAt: addDays(today, 0), config: JSON.stringify({ sender: "+966 11 234 5678" }) } });
  await db.integration.create({ data: { organizationId: oid, provider: "SMS", name: "SMS Gateway", status: "CONNECTED", lastSyncAt: addDays(today, -1), config: JSON.stringify({ senderName: "DARAK" }) } });
  const bank = await db.integration.create({ data: { organizationId: oid, provider: "BANK", name: "الربط البنكي — الراجحي", status: "ERROR", lastSyncAt: addDays(today, -2), lastError: "انتهت صلاحية رمز الوصول (401). يرجى إعادة الربط.", config: "{}" } });
  await db.integration.create({ data: { organizationId: oid, provider: "EMAIL", name: "البريد الإلكتروني", status: "CONNECTED", lastSyncAt: today, config: JSON.stringify({ from: "noreply@aldiyar.sa" }) } });
  await db.integrationLog.createMany({
    data: [
      { integrationId: bank.id, level: "ERROR", message: "401 Unauthorized — انتهت صلاحية الرمز", createdAt: addDays(today, -2) },
      { integrationId: bank.id, level: "INFO", message: "تم استيراد 41 حركة بنكية", createdAt: addDays(today, -3) },
    ],
  });

  // ── Bank transactions for reconciliation ──
  const recent = paymentsForBank.filter((p) => p.paidAt > addDays(today, -45));
  for (const p of recent.slice(0, 14)) {
    await db.bankTransaction.create({ data: { organizationId: oid, date: p.paidAt, amount: p.amount, reference: p.ref, description: `حوالة واردة — ${p.tenant}`, bank: "الراجحي", status: "MATCHED", paymentId: p.id } });
  }
  for (const p of recent.slice(14, 18)) {
    await db.bankTransaction.create({ data: { organizationId: oid, date: p.paidAt, amount: p.amount, reference: p.ref, description: `حوالة واردة — ${p.tenant}`, bank: "الراجحي", status: "SUGGESTED" } });
  }
  for (let i = 0; i < 4; i++) {
    await db.bankTransaction.create({ data: { organizationId: oid, date: d(-between(1, 12)), amount: between(5, 40) * 1000, reference: `TRF${between(100000000, 999999999)}`, description: `حوالة واردة — ${name()}`, bank: "الراجحي", status: "UNMATCHED" } });
  }
  if (recent[0]) await db.bankTransaction.create({ data: { organizationId: oid, date: recent[0].paidAt, amount: recent[0].amount, reference: recent[0].ref, description: `حوالة واردة — ${recent[0].tenant} (مكرر)`, bank: "الراجحي", status: "DUPLICATE" } });
  await db.bankTransaction.create({ data: { organizationId: oid, date: d(-4), amount: 12345.5, reference: `TRF${between(100000000, 999999999)}`, description: "حوالة واردة بدون بيان", bank: "الراجحي", status: "NEEDS_REVIEW" } });

  // ── Owner statements (last month) ──
  const lm = addMonths(today, -1);
  const ps = new Date(lm.getFullYear(), lm.getMonth(), 1);
  const pe = new Date(lm.getFullYear(), lm.getMonth() + 1, 0, 23, 59, 59);
  const statuses = ["PAID", "APPROVED", "UNDER_REVIEW", "DRAFT", "PAID", "DRAFT"];
  for (let i = 0; i < owners.length; i++) {
    const collected = between(40, 180) * 1000;
    const fees = Math.round((collected * owners[i].managementFeePct) / 100);
    const exp = between(2, 25) * 1000;
    await db.ownerStatement.create({ data: { organizationId: oid, code: `STM-${String(i + 1).padStart(4, "0")}`, ownerId: owners[i].id, periodStart: ps, periodEnd: pe, collectedRent: collected, managementFees: fees, expenses: exp, otherDeductions: 0, netDue: collected - fees - exp, status: statuses[i], paidAt: statuses[i] === "PAID" ? addDays(pe, 5) : null, createdAt: addDays(pe, 1) } });
  }

  // ── Saved views, import jobs, support ──
  await db.savedView.createMany({
    data: [
      { organizationId: oid, userId: collector.id, module: "collections", name: "متأخرات أكثر من 10,000 ريال", query: "minAmount=10000&status=OVERDUE" },
      { organizationId: oid, userId: manager.id, module: "contracts", name: "عقود تنتهي خلال 60 يوم", query: "expiring=60", isShared: true },
      { organizationId: oid, userId: leasing.id, module: "units", name: "الوحدات الشاغرة — الرياض", query: "status=VACANT&city=الرياض" },
    ],
  });
  await db.importJob.createMany({
    data: [
      { organizationId: oid, userId: manager.id, entityType: "PROPERTIES", fileName: "properties_2025.xlsx", totalRows: 8, successRows: 8, failedRows: 0, createdAt: addMonths(today, -3) },
      { organizationId: oid, userId: manager.id, entityType: "UNITS", fileName: "units_2025.xlsx", totalRows: 72, successRows: 70, failedRows: 2, errors: JSON.stringify([{ row: 14, message: "العقار PRP-0099 غير موجود." }, { row: 51, message: "رقم الوحدة مكرر: A-03" }]), createdAt: addMonths(today, -3) },
      { organizationId: oid, userId: accountant.id, entityType: "PAYMENTS", fileName: "payments_q2.csv", totalRows: 120, successRows: 117, failedRows: 3, errors: JSON.stringify([{ row: 9, message: "العقد CNT-0410 غير موجود." }, { row: 33, message: "المبلغ غير صالح: 'N/A'" }, { row: 88, message: "دفعة مكررة بنفس المرجع TRF552901" }]), createdAt: addMonths(today, -1) },
    ],
  });
  await db.supportTicket.createMany({
    data: [
      { organizationId: oid, userId: accountant.id, subject: "طلب تفعيل الربط البنكي مجددًا", body: "الربط مع الراجحي يعطي خطأ 401 منذ يومين.", status: "IN_PROGRESS", priority: "HIGH" },
      { organizationId: oid, userId: leasing.id, subject: "إضافة حقل مخصص للوحدات", body: "نحتاج حقل 'رقم العداد' في الوحدة.", status: "OPEN", priority: "LOW" },
      { organizationId: org2.id, subject: "استفسار عن الترقية للخطة الاحترافية", body: "ما الفرق في الحدود؟", status: "RESOLVED", priority: "MEDIUM" },
    ],
  });

  // ── Audit samples ──
  await db.auditLog.createMany({
    data: [
      { organizationId: oid, userId: manager.id, userName: manager.name, action: "LOGIN", entityType: "SESSION", entityLabel: manager.email, ip: "10.0.0.12", createdAt: addDays(today, -1) },
      { organizationId: oid, userId: leasing.id, userName: leasing.name, action: "CREATE", entityType: "CONTRACT", entityId: contracts[0].id, entityLabel: contracts[0].code, newValue: JSON.stringify({ status: "ACTIVE", totalAmount: 45000 }), ip: "10.0.0.31", createdAt: addDays(today, -3) },
      { organizationId: oid, userId: manager.id, userName: manager.name, action: "PERMISSION_CHANGE", entityType: "USER", entityId: pm2.id, entityLabel: pm2.name, oldValue: JSON.stringify({ assigned: [] }), newValue: JSON.stringify({ assigned: ["PRP-0006", "PRP-0007"] }), ip: "10.0.0.12", createdAt: addDays(today, -6) },
      { organizationId: oid, userId: accountant.id, userName: accountant.name, action: "EXPORT", entityType: "REPORT", entityLabel: "Aging Report — Excel", ip: "10.0.0.44", createdAt: addDays(today, -2) },
      { organizationId: oid, userId: null, userName: "دعم دارك", action: "SUPPORT_ACCESS", entityType: "ORGANIZATION", entityId: oid, entityLabel: org.name, newValue: JSON.stringify({ reason: "تذكرة #1 — الربط البنكي", durationMinutes: 30 }), ip: "185.0.0.9", createdAt: addDays(today, -1) },
    ],
  });

  // ── Notifications ──
  await db.notification.createMany({
    data: [
      { organizationId: oid, userId: manager.id, title: "مرحبًا بك في دارك", body: "تم إعداد المكتب بنجاح. أكمل قائمة الجاهزية للانطلاق.", severity: "SUCCESS", href: "/settings", deliveredAt: today },
      { organizationId: oid, userId: manager.id, title: "فشل المزامنة: الربط البنكي — الراجحي", body: "انتهت صلاحية رمز الوصول (401).", severity: "DANGER", entityType: "INTEGRATION", entityId: bank.id, href: "/integrations", deliveredAt: today },
      { organizationId: oid, userId: leasing.id, title: "معاينة اليوم — 3 عملاء محتملين", severity: "INFO", href: "/leasing", deliveredAt: today },
    ],
  });

  // ── Run engine: statuses, cases, automations ──
  console.log("⚙️  Running workflow engine…");
  const r = await runEngine(oid);
  console.log(`   engine updates: ${r.updates}`);

  // ── Collection actions on cases (history) ──
  const cases = await db.collectionCase.findMany({ where: { organizationId: oid }, include: { installment: { include: { tenant: true } } }, orderBy: { priority: "desc" } });
  console.log(`   collection cases: ${cases.length}`);
  for (let i = 0; i < cases.length; i++) {
    const k = cases[i];
    const collectorId = i % 3 === 0 ? collector2.id : collector.id;
    await db.collectionCase.update({ where: { id: k.id }, data: { collectorId } });
    if (i % 4 === 0) {
      // active promise
      await db.collectionAction.createMany({
        data: [
          { caseId: k.id, type: "SMS", note: "تم إرسال تذكير", byUserId: collectorId, createdAt: d(-3) },
          { caseId: k.id, type: "CALL", outcome: "NO_ANSWER", note: "لا يوجد رد", byUserId: collectorId, createdAt: d(-2) },
          { caseId: k.id, type: "WHATSAPP", outcome: "ANSWERED", note: "المستأجر سيتواصل غدًا", byUserId: collectorId, createdAt: d(-2) },
          { caseId: k.id, type: "PROMISE", outcome: "PROMISED", note: `وعد بالسداد الكامل`, byUserId: collectorId, createdAt: d(-1) },
        ],
      });
      await db.collectionCase.update({ where: { id: k.id }, data: { followUpStatus: "PROMISE_TO_PAY", promiseAmount: k.installment.amount - k.installment.paidAmount, promiseDate: d(between(2, 6)), lastActionAt: d(-1), nextAction: "متابعة الوعد", nextActionDate: d(between(2, 6)) } });
    } else if (i % 4 === 1) {
      // broken promise (promise date in the past) -> engine will flip it
      await db.collectionAction.createMany({
        data: [
          { caseId: k.id, type: "CALL", outcome: "ANSWERED", note: "تم التواصل، طلب مهلة", byUserId: collectorId, createdAt: d(-9) },
          { caseId: k.id, type: "PROMISE", outcome: "PROMISED", note: "وعد بالسداد يوم الخميس", byUserId: collectorId, createdAt: d(-9) },
        ],
      });
      await db.collectionCase.update({ where: { id: k.id }, data: { followUpStatus: "PROMISE_TO_PAY", promiseAmount: k.installment.amount - k.installment.paidAmount, promiseDate: d(-3), lastActionAt: d(-9) } });
    } else if (i % 4 === 2) {
      await db.collectionAction.createMany({
        data: [
          { caseId: k.id, type: "SMS", note: "تذكير آلي بالاستحقاق", byUserId: null, createdAt: d(-5) },
          { caseId: k.id, type: "CALL", outcome: "NO_ANSWER", note: "لا يوجد رد — المحاولة الأولى", byUserId: collectorId, createdAt: d(-4) },
          { caseId: k.id, type: "CALL", outcome: "NO_ANSWER", note: "لا يوجد رد — المحاولة الثانية", byUserId: collectorId, createdAt: d(-1) },
        ],
      });
      await db.collectionCase.update({ where: { id: k.id }, data: { followUpStatus: "OPEN", lastActionAt: d(-1), nextAction: "زيارة ميدانية", nextActionDate: d(1) } });
    }
    // i%4===3 stays OPEN with no action yet
  }
  // second engine pass to flip broken promises & score
  await runEngine(oid);

  const counts = {
    users: await db.user.count(),
    owners: await db.owner.count({ where: { organizationId: oid } }),
    properties: await db.property.count({ where: { organizationId: oid } }),
    units: await db.unit.count({ where: { organizationId: oid } }),
    tenants: await db.tenant.count({ where: { organizationId: oid } }),
    contracts: await db.contract.count({ where: { organizationId: oid } }),
    installments: await db.installment.count({ where: { organizationId: oid } }),
    overdue: await db.installment.count({ where: { organizationId: oid, status: "OVERDUE" } }),
    payments: await db.payment.count({ where: { organizationId: oid } }),
    cases: await db.collectionCase.count({ where: { organizationId: oid } }),
    tasks: await db.task.count({ where: { organizationId: oid } }),
    expenses: await db.expense.count({ where: { organizationId: oid } }),
  };
  console.log("✅ Demo seed complete", counts);
  console.log("   demo logins (SMS code in dev console):", DEMO_PHONES);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
