// Import Center — server-side validation & insertion per entity type.
// Never silently drops rows: every problem is reported per row.
import { db } from "@/lib/db";
import { nextCode } from "@/lib/codes";
import { buildSchedule, getOrgSettings, computeInstallmentStatus, refreshInstallments, scheduleCount, annualRent } from "@/lib/engine";
import { daysBetween } from "@/lib/format";
import { IMPORT_FIELDS, normalizeNumber, normalizeDate, normalizeEnum, type ImportEntity, type FieldSpec, type RowResult } from "./spec";

export type RawRow = Record<string, string>;

export interface ParsedRow {
  row: number;
  ok: boolean;
  errors: string[];
  data: Record<string, unknown>;
  preview: Record<string, string>;
}

const str = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());

/** Coerce raw strings using the field spec. Returns typed data + type/required errors. */
function coerce(fields: FieldSpec[], raw: RawRow) {
  const data: Record<string, unknown> = {};
  const errors: string[] = [];
  for (const f of fields) {
    const v = str(raw[f.key]);
    if (!v) {
      if (f.required) errors.push(`الحقل «${f.label}» مطلوب`);
      data[f.key] = null;
      continue;
    }
    switch (f.type) {
      case "number": {
        const n = normalizeNumber(v);
        if (n === null) errors.push(`قيمة غير صالحة في «${f.label}»: '${v}'`);
        data[f.key] = n;
        break;
      }
      case "int": {
        const n = normalizeNumber(v);
        if (n === null || !Number.isInteger(n)) errors.push(`رقم صحيح مطلوب في «${f.label}»: '${v}'`);
        data[f.key] = n === null ? null : Math.round(n);
        break;
      }
      case "date": {
        const d = normalizeDate(v);
        if (!d) errors.push(`تاريخ غير صالح في «${f.label}»: '${v}' (الصيغة: yyyy-mm-dd)`);
        data[f.key] = d;
        break;
      }
      case "enum": {
        const e = normalizeEnum(v, f.options ?? {});
        if (!e) errors.push(`قيمة غير معروفة في «${f.label}»: '${v}'`);
        data[f.key] = e;
        break;
      }
      default:
        data[f.key] = v;
    }
  }
  return { data, errors };
}

const previewOf = (fields: FieldSpec[], raw: RawRow, keys: string[]) =>
  Object.fromEntries(keys.map((k) => [fields.find((f) => f.key === k)?.label ?? k, str(raw[k])]));

/* ───────────────────────── Context (batch lookups) ───────────────────────── */

interface Ctx {
  orgId: string;
  propertiesByCode: Map<string, { id: string; name: string; ownerId: string | null }>;
  unitsByCode: Map<string, { id: string; propertyId: string; number: string; activeContract: boolean }>;
  unitNumbers: Set<string>; // propertyId|number
  unitCodes: Set<string>;
  ownersByCode: Map<string, string>;
  ownerNationalIds: Set<string>;
  ownerPhoneName: Set<string>;
  tenantsByCode: Map<string, string>;
  tenantsByNationalId: Map<string, string>;
  tenantPhoneName: Set<string>;
  contractsByCode: Map<string, { id: string; tenantId: string; installments: { id: string; seq: number; amount: number; paidAmount: number; status: string }[] }>;
  contractCodes: Set<string>;
  paymentCodes: Set<string>;
  paymentRefs: Set<string>;
  propertyCodes: Set<string>;
  deedNumbers: Set<string>;
}

const up = (s: string) => s.trim().toUpperCase();

async function loadCtx(orgId: string, entity: ImportEntity): Promise<Ctx> {
  const ctx: Ctx = {
    orgId,
    propertiesByCode: new Map(),
    unitsByCode: new Map(),
    unitNumbers: new Set(),
    unitCodes: new Set(),
    ownersByCode: new Map(),
    ownerNationalIds: new Set(),
    ownerPhoneName: new Set(),
    tenantsByCode: new Map(),
    tenantsByNationalId: new Map(),
    tenantPhoneName: new Set(),
    contractsByCode: new Map(),
    contractCodes: new Set(),
    paymentCodes: new Set(),
    paymentRefs: new Set(),
    propertyCodes: new Set(),
    deedNumbers: new Set(),
  };
  if (["PROPERTIES", "UNITS", "OWNERS", "CONTRACTS"].includes(entity)) {
    const props = await db.property.findMany({ where: { organizationId: orgId }, select: { id: true, code: true, name: true, deedNumber: true, ownerships: { where: { endDate: null }, select: { ownerId: true }, orderBy: { percentage: "desc" }, take: 1 } } });
    for (const p of props) {
      ctx.propertiesByCode.set(up(p.code), { id: p.id, name: p.name, ownerId: p.ownerships[0]?.ownerId ?? null });
      ctx.propertyCodes.add(up(p.code));
      if (p.deedNumber) ctx.deedNumbers.add(p.deedNumber.trim());
    }
  }
  if (["UNITS", "CONTRACTS"].includes(entity)) {
    const units = await db.unit.findMany({ where: { organizationId: orgId }, select: { id: true, code: true, number: true, propertyId: true, contracts: { where: { status: { in: ["ACTIVE", "EXPIRING_SOON", "RENEWAL_PENDING"] } }, select: { id: true }, take: 1 } } });
    for (const u of units) {
      ctx.unitsByCode.set(up(u.code), { id: u.id, propertyId: u.propertyId, number: u.number, activeContract: u.contracts.length > 0 });
      ctx.unitCodes.add(up(u.code));
      ctx.unitNumbers.add(`${u.propertyId}|${up(u.number)}`);
    }
  }
  if (["OWNERS", "PROPERTIES"].includes(entity)) {
    const owners = await db.owner.findMany({ where: { organizationId: orgId }, select: { id: true, code: true, nationalId: true, phone: true, name: true } });
    for (const o of owners) {
      ctx.ownersByCode.set(up(o.code), o.id);
      if (o.nationalId) ctx.ownerNationalIds.add(o.nationalId.trim());
      if (o.phone) ctx.ownerPhoneName.add(`${o.phone.replace(/\D/g, "")}|${o.name.trim()}`);
    }
  }
  if (["TENANTS", "CONTRACTS"].includes(entity)) {
    const tenants = await db.tenant.findMany({ where: { organizationId: orgId }, select: { id: true, code: true, nationalId: true, phone: true, name: true } });
    for (const t of tenants) {
      ctx.tenantsByCode.set(up(t.code), t.id);
      if (t.nationalId) ctx.tenantsByNationalId.set(t.nationalId.trim(), t.id);
      if (t.phone) ctx.tenantPhoneName.add(`${t.phone.replace(/\D/g, "")}|${t.name.trim()}`);
    }
  }
  if (["CONTRACTS", "INSTALLMENTS", "PAYMENTS"].includes(entity)) {
    const contracts = await db.contract.findMany({
      where: { organizationId: orgId },
      select: { id: true, code: true, tenantId: true, installments: { select: { id: true, seq: true, amount: true, paidAmount: true, status: true }, orderBy: { seq: "asc" } } },
    });
    for (const c of contracts) {
      ctx.contractsByCode.set(up(c.code), { id: c.id, tenantId: c.tenantId, installments: c.installments });
      ctx.contractCodes.add(up(c.code));
    }
  }
  if (entity === "PAYMENTS") {
    const pays = await db.payment.findMany({ where: { organizationId: orgId }, select: { code: true, reference: true } });
    for (const p of pays) {
      ctx.paymentCodes.add(up(p.code));
      if (p.reference) ctx.paymentRefs.add(up(p.reference));
    }
  }
  return ctx;
}

/* ───────────────────────── Validation ───────────────────────── */

export async function validateRows(orgId: string, entity: ImportEntity, rows: RawRow[]): Promise<{ parsed: ParsedRow[]; ctx: Ctx }> {
  const fields = IMPORT_FIELDS[entity];
  const ctx = await loadCtx(orgId, entity);
  const seen = {
    code: new Set<string>(),
    nationalId: new Set<string>(),
    phoneName: new Set<string>(),
    unitNumber: new Set<string>(),
    reference: new Set<string>(),
    contractSeq: new Set<string>(),
    deed: new Set<string>(),
    name: new Set<string>(),
  };
  const parsed: ParsedRow[] = [];

  rows.forEach((raw, i) => {
    const row = i + 2; // header is row 1
    const { data, errors } = coerce(fields, raw);
    const code = str(data.code);
    const dupCode = (existing: Set<string>, label: string) => {
      if (!code) return;
      if (existing.has(up(code))) errors.push(`${label} ${code} موجود مسبقًا`);
      else if (seen.code.has(up(code))) errors.push(`الرمز ${code} مكرر داخل الملف`);
      seen.code.add(up(code));
    };
    const dupParty = (nationalIds: Set<string> | Map<string, string>, phoneNames: Set<string>) => {
      const nid = str(data.nationalId);
      if (nid) {
        if (nationalIds.has(nid)) errors.push(`رقم الهوية ${nid} مسجل مسبقًا`);
        else if (seen.nationalId.has(nid)) errors.push(`رقم الهوية ${nid} مكرر داخل الملف`);
        seen.nationalId.add(nid);
      }
      const phone = str(data.phone).replace(/\D/g, "");
      const name = str(data.name);
      if (phone && name) {
        const k = `${phone}|${name}`;
        if (phoneNames.has(k)) errors.push(`يوجد سجل بنفس الاسم ورقم الجوال (${name})`);
        else if (seen.phoneName.has(k)) errors.push(`الاسم ورقم الجوال مكرران داخل الملف (${name})`);
        seen.phoneName.add(k);
      }
    };

    let previewKeys: string[] = [];

    switch (entity) {
      case "PROPERTIES": {
        previewKeys = ["code", "name", "type", "city", "ownerCode"];
        dupCode(ctx.propertyCodes, "رمز العقار");
        const deed = str(data.deedNumber);
        if (deed) {
          if (ctx.deedNumbers.has(deed)) errors.push(`رقم الصك ${deed} مسجل لعقار آخر`);
          else if (seen.deed.has(deed)) errors.push(`رقم الصك ${deed} مكرر داخل الملف`);
          seen.deed.add(deed);
        }
        const name = str(data.name);
        if (name) {
          if (seen.name.has(name)) errors.push(`اسم العقار «${name}» مكرر داخل الملف`);
          seen.name.add(name);
        }
        const oc = str(data.ownerCode);
        if (oc && !ctx.ownersByCode.has(up(oc))) errors.push(`المالك ${oc} غير موجود`);
        break;
      }
      case "UNITS": {
        previewKeys = ["propertyCode", "number", "type", "targetRent", "status"];
        dupCode(ctx.unitCodes, "رمز الوحدة");
        const pc = str(data.propertyCode);
        const prop = pc ? ctx.propertiesByCode.get(up(pc)) : undefined;
        if (pc && !prop) errors.push(`العقار ${pc} غير موجود`);
        const number = str(data.number);
        if (prop && number) {
          const k = `${prop.id}|${up(number)}`;
          if (ctx.unitNumbers.has(k)) errors.push(`رقم الوحدة مكرر: ${number} في العقار ${pc}`);
          else if (seen.unitNumber.has(k)) errors.push(`رقم الوحدة ${number} مكرر داخل الملف للعقار ${pc}`);
          seen.unitNumber.add(k);
        }
        if (prop) data.propertyId = prop.id;
        break;
      }
      case "OWNERS": {
        previewKeys = ["code", "name", "nationalId", "phone", "propertyCode"];
        dupCode(new Set(ctx.ownersByCode.keys()), "رمز المالك");
        dupParty(ctx.ownerNationalIds, ctx.ownerPhoneName);
        const pc = str(data.propertyCode);
        if (pc) {
          const prop = ctx.propertiesByCode.get(up(pc));
          if (!prop) errors.push(`العقار ${pc} غير موجود`);
          else data.propertyId = prop.id;
          const pctv = data.ownershipPct as number | null;
          if (pctv !== null && (pctv <= 0 || pctv > 100)) errors.push("نسبة الملكية يجب أن تكون بين 1 و 100");
        }
        break;
      }
      case "TENANTS": {
        previewKeys = ["code", "name", "nationalId", "phone", "riskLevel"];
        dupCode(new Set(ctx.tenantsByCode.keys()), "رمز المستأجر");
        dupParty(ctx.tenantsByNationalId, ctx.tenantPhoneName);
        break;
      }
      case "CONTRACTS": {
        previewKeys = ["code", "unitCode", "tenantCode", "startDate", "endDate", "totalAmount"];
        dupCode(ctx.contractCodes, "رمز العقد");
        const uc = str(data.unitCode);
        const unit = uc ? ctx.unitsByCode.get(up(uc)) : undefined;
        if (uc && !unit) errors.push(`الوحدة ${uc} غير موجودة`);
        if (unit) {
          if (unit.activeContract) errors.push(`الوحدة ${uc} لديها عقد نشط بالفعل`);
          else if (seen.unitNumber.has(unit.id)) errors.push(`الوحدة ${uc} مكررة في أكثر من عقد داخل الملف`);
          seen.unitNumber.add(unit.id);
          data.unitId = unit.id;
          data.propertyId = unit.propertyId;
          const prop = [...ctx.propertiesByCode.values()].find((p) => p.id === unit.propertyId);
          if (!prop?.ownerId) errors.push(`العقار المرتبط بالوحدة ${uc} ليس له مالك حالي`);
          else data.ownerId = prop.ownerId;
        }
        const tc = str(data.tenantCode);
        const tenantId = tc ? ctx.tenantsByCode.get(up(tc)) ?? ctx.tenantsByNationalId.get(tc) : undefined;
        if (tc && !tenantId) errors.push(`المستأجر ${tc} غير موجود`);
        if (tenantId) data.tenantId = tenantId;
        const sd = data.startDate as Date | null;
        const ed = data.endDate as Date | null;
        if (sd && ed && ed <= sd) errors.push("تاريخ النهاية يجب أن يكون بعد تاريخ البداية");
        const amt = data.totalAmount as number | null;
        if (amt !== null && amt <= 0) errors.push("قيمة العقد يجب أن تكون أكبر من صفر");
        if (data.paymentFrequency === "CUSTOM" && !(data.installmentsCount as number | null)) errors.push("عدد الأقساط مطلوب عند الدورية «مخصص»");
        break;
      }
      case "INSTALLMENTS": {
        previewKeys = ["contractCode", "seq", "dueDate", "amount"];
        const cc = str(data.contractCode);
        const c = cc ? ctx.contractsByCode.get(up(cc)) : undefined;
        if (cc && !c) errors.push(`العقد ${cc} غير موجود`);
        const seq = data.seq as number | null;
        if (c && seq !== null) {
          const k = `${c.id}|${seq}`;
          if (c.installments.some((x) => x.seq === seq)) errors.push(`القسط رقم ${seq} موجود مسبقًا في العقد ${cc}`);
          else if (seen.contractSeq.has(k)) errors.push(`القسط رقم ${seq} مكرر داخل الملف للعقد ${cc}`);
          seen.contractSeq.add(k);
          data.contractId = c.id;
          data.tenantId = c.tenantId;
        }
        const amt = data.amount as number | null;
        if (amt !== null && amt <= 0) errors.push("مبلغ القسط يجب أن يكون أكبر من صفر");
        const paid = data.paidAmount as number | null;
        if (paid !== null && amt !== null && (paid < 0 || paid > amt)) errors.push("المدفوع يجب أن يكون بين صفر ومبلغ القسط");
        break;
      }
      case "PAYMENTS": {
        previewKeys = ["code", "contractCode", "seq", "paidAt", "amount", "reference"];
        dupCode(ctx.paymentCodes, "رمز الدفعة");
        const ref = str(data.reference);
        if (ref) {
          if (ctx.paymentRefs.has(up(ref))) errors.push(`دفعة مكررة بنفس المرجع ${ref}`);
          else if (seen.reference.has(up(ref))) errors.push(`المرجع ${ref} مكرر داخل الملف`);
          seen.reference.add(up(ref));
        }
        const cc = str(data.contractCode);
        const c = cc ? ctx.contractsByCode.get(up(cc)) : undefined;
        if (cc && !c) errors.push(`العقد ${cc} غير موجود`);
        const seq = data.seq as number | null;
        if (c) {
          data.contractId = c.id;
          data.tenantId = c.tenantId;
          if (seq !== null && !c.installments.some((x) => x.seq === seq)) errors.push(`القسط رقم ${seq} غير موجود في العقد ${cc}`);
          if (seq === null && !c.installments.some((x) => x.status !== "PAID" && x.status !== "WAIVED")) errors.push(`لا يوجد قسط مفتوح في العقد ${cc} لتخصيص الدفعة`);
        }
        const amt = data.amount as number | null;
        if (amt !== null && amt <= 0) errors.push("مبلغ الدفعة يجب أن يكون أكبر من صفر");
        const pd = data.paidAt as Date | null;
        if (pd && daysBetween(new Date(), pd) > 0) errors.push("تاريخ الدفع لا يمكن أن يكون في المستقبل");
        break;
      }
    }

    parsed.push({ row, ok: errors.length === 0, errors, data, preview: previewOf(fields, raw, previewKeys) });
  });

  return { parsed, ctx };
}

export const toRowResults = (parsed: ParsedRow[]): RowResult[] => parsed.map(({ row, ok, errors, preview }) => ({ row, ok, errors, preview }));

/* ───────────────────────── Insertion ───────────────────────── */

/** Inserts one validated row. Returns a label of the created entity. Throws on failure. */
export async function insertRow(entity: ImportEntity, d: Record<string, unknown>, ctx: Ctx, userId: string): Promise<string> {
  const orgId = ctx.orgId;
  const s = (k: string) => (d[k] === null || d[k] === undefined ? null : String(d[k]));
  const n = (k: string) => (d[k] === null || d[k] === undefined ? null : Number(d[k]));
  const dt = (k: string) => d[k] as Date;

  switch (entity) {
    case "PROPERTIES": {
      const code = s("code") ?? (await nextCode(orgId, "property"));
      const ownerId = s("ownerCode") ? ctx.ownersByCode.get(up(s("ownerCode")!)) : undefined;
      const p = await db.property.create({
        data: {
          organizationId: orgId,
          code,
          name: s("name")!,
          type: s("type") ?? "RESIDENTIAL_BUILDING",
          city: s("city"),
          district: s("district"),
          street: s("street"),
          deedNumber: s("deedNumber"),
          landArea: n("landArea"),
          buildingArea: n("buildingArea"),
          floors: n("floors"),
          buildYear: n("buildYear"),
          status: s("status") ?? "ACTIVE",
          notes: s("notes"),
          ...(ownerId ? { ownerships: { create: { ownerId, percentage: 100, startDate: new Date() } } } : {}),
        },
      });
      ctx.propertiesByCode.set(up(code), { id: p.id, name: p.name, ownerId: ownerId ?? null });
      return `${code} — ${p.name}`;
    }
    case "UNITS": {
      const code = s("code") ?? (await nextCode(orgId, "unit"));
      const u = await db.unit.create({
        data: {
          organizationId: orgId,
          propertyId: s("propertyId")!,
          code,
          number: s("number")!,
          floor: s("floor"),
          type: s("type") ?? "APARTMENT",
          usage: s("usage") ?? "RESIDENTIAL",
          area: n("area"),
          rooms: n("rooms"),
          bathrooms: n("bathrooms"),
          targetRent: n("targetRent"),
          currentRent: n("currentRent"),
          status: s("status") ?? "VACANT",
          notes: s("notes"),
        },
      });
      return `${code} — وحدة ${u.number}`;
    }
    case "OWNERS": {
      const code = s("code") ?? (await nextCode(orgId, "owner"));
      const propertyId = s("propertyId");
      const o = await db.owner.create({
        data: {
          organizationId: orgId,
          code,
          name: s("name")!,
          type: s("type") ?? "INDIVIDUAL",
          nationalId: s("nationalId"),
          crNumber: s("crNumber"),
          phone: s("phone"),
          email: s("email"),
          iban: s("iban"),
          bankName: s("bankName"),
          managementFeePct: n("managementFeePct") ?? 5,
          notes: s("notes"),
          ...(propertyId ? { ownerships: { create: { propertyId, percentage: n("ownershipPct") ?? 100, startDate: new Date() } } } : {}),
        },
      });
      ctx.ownersByCode.set(up(code), o.id);
      return `${code} — ${o.name}`;
    }
    case "TENANTS": {
      const code = s("code") ?? (await nextCode(orgId, "tenant"));
      const t = await db.tenant.create({
        data: {
          organizationId: orgId,
          code,
          name: s("name")!,
          type: s("type") ?? "INDIVIDUAL",
          nationalId: s("nationalId"),
          idExpiry: (d.idExpiry as Date | null) ?? null,
          crNumber: s("crNumber"),
          phone: s("phone"),
          email: s("email"),
          employer: s("employer"),
          riskLevel: s("riskLevel") ?? "LOW",
          notes: s("notes"),
        },
      });
      ctx.tenantsByCode.set(up(code), t.id);
      return `${code} — ${t.name}`;
    }
    case "CONTRACTS": {
      const code = s("code") ?? (await nextCode(orgId, "contract"));
      const startDate = dt("startDate");
      const endDate = dt("endDate");
      const totalAmount = n("totalAmount")!;
      const frequency = s("paymentFrequency") ?? "QUARTERLY";
      const months = Math.max(1, Math.round(daysBetween(startDate, endDate) / 30.4375));
      const status = s("status") ?? "ACTIVE";
      // Only running contracts get a billable schedule. Drafts / pending get theirs on activation; closed contracts
      // (expired, terminated, cancelled) are history and must not create unpaid installments or collection claims.
      const open = ["ACTIVE", "EXPIRING_SOON", "RENEWAL_PENDING"].includes(status);
      const schedule = open ? buildSchedule({ startDate, totalAmount, frequency, installmentsCount: n("installmentsCount") ?? undefined, months }) : [];
      const settings = await getOrgSettings(orgId);
      const c = await db.$transaction(async (tx) => {
        const created = await tx.contract.create({
          data: {
            organizationId: orgId,
            code,
            propertyId: s("propertyId")!,
            unitId: s("unitId")!,
            tenantId: s("tenantId")!,
            ownerId: s("ownerId")!,
            startDate,
            endDate,
            totalAmount,
            managementFeePct: n("managementFeePct") ?? 5,
            vatAmount: 0,
            paymentFrequency: frequency,
            installmentsCount: schedule.length || scheduleCount(months, frequency, n("installmentsCount")),
            status,
            notes: s("notes"),
            createdById: userId,
          },
        });
        if (schedule.length) await tx.installment.createMany({
          data: schedule.map((r) => ({
            organizationId: orgId,
            contractId: created.id,
            tenantId: s("tenantId")!,
            seq: r.seq,
            dueDate: r.dueDate,
            amount: r.amount,
            status: computeInstallmentStatus({ dueDate: r.dueDate, amount: r.amount, paidAmount: 0, status: "UPCOMING" }, settings, frequency),
          })),
        });
        if (open) {
          await tx.unit.update({ where: { id: s("unitId")! }, data: { status: "RENTED", currentRent: annualRent(totalAmount, months) } });
        }
        return created;
      });
      const unit = ctx.unitsByCode.get(up(s("unitCode")!));
      if (unit) unit.activeContract = true;
      return schedule.length ? `${code} — ${schedule.length} أقساط` : `${code} — بدون جدول (${status})`;
    }
    case "INSTALLMENTS": {
      const settings = await getOrgSettings(orgId);
      const amount = n("amount")!;
      const paidAmount = n("paidAmount") ?? 0;
      const dueDate = dt("dueDate");
      const frequency = (await db.contract.findFirst({ where: { id: s("contractId")!, organizationId: orgId }, select: { paymentFrequency: true } }))?.paymentFrequency ?? null;
      const status = s("status") ?? computeInstallmentStatus({ dueDate, amount, paidAmount, status: "UPCOMING" }, settings, frequency);
      // paidAmount here is an opening balance (paid before DARAK): kept in openingPaid so later allocations add to it.
      const inst = await db.installment.create({
        data: { organizationId: orgId, contractId: s("contractId")!, tenantId: s("tenantId")!, seq: n("seq")!, dueDate, amount, paidAmount, openingPaid: paidAmount, status },
      });
      const c = ctx.contractsByCode.get(up(s("contractCode")!));
      c?.installments.push({ id: inst.id, seq: inst.seq, amount, paidAmount, status });
      return `${s("contractCode")} / قسط ${inst.seq}`;
    }
    case "PAYMENTS": {
      const code = s("code") ?? (await nextCode(orgId, "payment"));
      const c = ctx.contractsByCode.get(up(s("contractCode")!))!;
      const amount = n("amount")!;
      const seq = n("seq");
      // Allocation: from the given installment (or the oldest open one) onwards, never more than each installment's
      // remaining balance. Anything beyond the open balance stays unallocated on the سند (tenant credit).
      const open = c.installments.filter((x) => x.status !== "PAID" && x.status !== "WAIVED").sort((a, b) => a.seq - b.seq);
      const targets = seq !== null ? open.filter((x) => x.seq >= seq) : open;
      const allocations: { installmentId: string; amount: number }[] = [];
      let left = amount;
      for (const t of targets) {
        if (left <= 0.009) break;
        const a = Math.min(left, Math.max(0, t.amount - t.paidAmount));
        if (a > 0.009) {
          allocations.push({ installmentId: t.id, amount: Math.round(a * 100) / 100 });
          left -= a;
        }
      }
      const p = await db.payment.create({
        data: {
          organizationId: orgId,
          code,
          tenantId: c.tenantId,
          contractId: c.id,
          paidAt: dt("paidAt"),
          amount,
          method: s("method") ?? "BANK_TRANSFER",
          reference: s("reference"),
          bank: s("bank"),
          notes: s("notes"),
          status: "RECORDED",
          recordedById: userId,
          allocations: { create: allocations },
        },
      });
      await refreshInstallments(orgId, allocations.map((a) => a.installmentId));
      for (const a of allocations) {
        const inst = c.installments.find((x) => x.id === a.installmentId);
        if (inst) {
          inst.paidAmount += a.amount;
          if (inst.paidAmount >= inst.amount - 0.01) inst.status = "PAID";
        }
      }
      ctx.paymentCodes.add(up(code));
      return `${p.code} — ${amount} ر.س`;
    }
  }
  throw new Error("نوع البيانات غير مدعوم.");
}
