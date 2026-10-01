// Sandbox office for the test accounts (lib/test-accounts.ts). Created on demand by the platform admin.
import { db } from "./db";
import { PRESETS } from "./permissions";
import { nextCode } from "./codes";
import { buildSchedule } from "./schedule";
import { refreshInstallments, runEngine } from "./engine";
import { addDays, addMonths, startOfDay } from "./format";
import { TEST_ACCOUNTS, testAccountsEnabled } from "./test-accounts";

const SANDBOX_SLUG = "darak-test";

const employee = (key: string) => {
  const p = PRESETS.find((x) => x.key === key)!;
  return { role: "EMPLOYEE", permissions: JSON.stringify(p.permissions), allProperties: p.allProperties };
};

/**
 * Creates the sandbox office with every test account, two properties, units, contracts and a few receipts, then runs
 * the engine so claims and statuses are real. Idempotent: does nothing when the office or the owner number exists.
 */
export async function ensureTestOffice(): Promise<{ created: boolean; message: string }> {
  if (!testAccountsEnabled()) return { created: false, message: "الحسابات التجريبية متوقفة (TEST_ACCOUNTS=off)." };
  const [existingOrg, ownerTaken] = await Promise.all([
    db.organization.findUnique({ where: { slug: SANDBOX_SLUG }, select: { id: true } }),
    db.user.findUnique({ where: { phone: TEST_ACCOUNTS[0].phone }, select: { id: true } }),
  ]);
  if (existingOrg || ownerTaken) return { created: false, message: "الحسابات التجريبية جاهزة مسبقًا." };

  const taken = new Set((await db.user.findMany({ where: { phone: { in: TEST_ACCOUNTS.map((a) => a.phone) } }, select: { phone: true } })).map((u) => u.phone));
  const free = (phone: string) => !taken.has(phone);
  const today = startOfDay(new Date());

  const org = await db.organization.create({
    data: { name: "مكتب تجريبي — دارك", slug: SANDBOX_SLUG, city: "الرياض", phone: "0110000000", plan: "PROFESSIONAL", status: "ACTIVE", unitsLimit: 100, usersLimit: 25, renewalDate: addMonths(today, 12) },
  });
  const oid = org.id;

  const owner = await db.user.create({ data: { organizationId: oid, name: "عبدالله المالكي", phone: "966500000001", role: "ACCOUNT_OWNER", jobTitle: "صاحب المكتب" } });
  const staff: Record<string, { id: string } | null> = {};
  for (const [phone, name, preset, title] of [
    ["966500000002", "سلمان العتيبي", "PROPERTY", "مدير عقارات"],
    ["966500000004", "نورة القحطاني", "LEASING", "مسؤولة تأجير"],
    ["966500000005", "فهد الشمري", "COLLECTION", "محصل"],
    ["966500000007", "ماجد الحربي", "ACCOUNTING", "محاسب"],
    ["966500000009", "لمى السبيعي", "READONLY", "مراجعة"],
  ] as const) {
    staff[preset] = free(phone) ? await db.user.create({ data: { organizationId: oid, name, phone, jobTitle: title, managerId: owner.id, ...employee(preset) } }) : null;
  }

  const landlord = await db.owner.create({
    data: { organizationId: oid, code: await nextCode(oid, "owner"), name: "خالد بن سعد الدوسري", phone: "966500000010", type: "INDIVIDUAL", managementFeePct: 5, status: "ACTIVE" },
  });
  if (free("966500000010")) await db.user.create({ data: { organizationId: oid, name: landlord.name, phone: "966500000010", role: "OWNER", ownerId: landlord.id } });

  const props = [
    { name: "عمارة النخيل التجريبية", district: "النرجس", rents: [42000, 45000, 38000, 40000] },
    { name: "مجمع الياسمين التجريبي", district: "الياسمين", rents: [55000, 52000, 60000] },
  ];
  const tenantsData = [
    { name: "أحمد سعد الحربي", phone: "966500000011" },
    { name: "سعود ناصر البقمي", phone: "966512340001" },
    { name: "شركة روافد للتجارة", phone: "966512340002" },
    { name: "نواف فهد الغامدي", phone: "966512340003" },
    { name: "ريم عبدالله المطيري", phone: "966512340004" },
  ];
  let tIdx = 0;
  const installmentIds: string[] = [];
  for (const [pi, p] of props.entries()) {
    const property = await db.property.create({
      data: { organizationId: oid, code: await nextCode(oid, "property"), name: p.name, type: "RESIDENTIAL_BUILDING", city: "الرياض", district: p.district, managerId: staff.PROPERTY?.id ?? null, ownerships: { create: [{ ownerId: landlord.id, percentage: 100, startDate: addMonths(today, -24) }] } },
    });
    if (pi === 0 && staff.PROPERTY) await db.propertyAssignment.create({ data: { userId: staff.PROPERTY.id, propertyId: property.id } });
    for (const [ui, rent] of p.rents.entries()) {
      const unit = await db.unit.create({ data: { organizationId: oid, propertyId: property.id, code: await nextCode(oid, "unit"), number: `${pi === 0 ? "A" : "B"}-${ui + 1}`, type: "APARTMENT", status: "VACANT", targetRent: rent } });
      // the last unit of each property stays vacant
      if (ui === p.rents.length - 1 || tIdx >= tenantsData.length) continue;
      const t = tenantsData[tIdx++];
      const tenant = await db.tenant.create({ data: { organizationId: oid, code: await nextCode(oid, "tenant"), name: t.name, phone: t.phone, type: t.name.startsWith("شركة") ? "COMPANY" : "INDIVIDUAL", status: "ACTIVE" } });
      if (t.phone === "966500000011" && free(t.phone)) await db.user.create({ data: { organizationId: oid, name: t.name, phone: t.phone, role: "TENANT", tenantId: tenant.id } });
      const frequency = ui % 2 === 0 ? "QUARTERLY" : "MONTHLY";
      const start = addMonths(today, -(4 + ui));
      const schedule = buildSchedule({ startDate: start, totalAmount: rent, frequency });
      const contract = await db.contract.create({
        data: {
          organizationId: oid, code: await nextCode(oid, "contract"), propertyId: property.id, unitId: unit.id, tenantId: tenant.id, ownerId: landlord.id,
          startDate: start, endDate: addDays(addMonths(start, 12), -1), totalAmount: rent, managementFeePct: 5, paymentFrequency: frequency,
          installmentsCount: schedule.length, status: "ACTIVE", createdById: staff.LEASING?.id ?? owner.id,
        },
      });
      await db.unit.update({ where: { id: unit.id }, data: { status: "RENTED", currentRent: rent } });
      for (const s of schedule) {
        const inst = await db.installment.create({ data: { organizationId: oid, contractId: contract.id, tenantId: tenant.id, seq: s.seq, dueDate: s.dueDate, amount: s.amount, status: "UPCOMING" } });
        installmentIds.push(inst.id);
        // the first installment is paid for everyone; one tenant in three is late on the rest
        if (s.seq === 1 || (s.dueDate < today && tIdx % 3 !== 0 && s.seq === 2)) {
          await db.payment.create({
            data: {
              organizationId: oid, code: await nextCode(oid, "payment"), tenantId: tenant.id, contractId: contract.id, paidAt: addDays(s.dueDate, 2), amount: s.amount,
              method: "BANK_TRANSFER", status: "APPROVED", recordedById: staff.COLLECTION?.id ?? owner.id, allocations: { create: [{ installmentId: inst.id, amount: s.amount }] },
            },
          });
        }
      }
    }
  }

  await refreshInstallments(oid, installmentIds);
  await runEngine(oid);
  return { created: true, message: "تم تجهيز المكتب التجريبي والحسابات التجريبية." };
}
