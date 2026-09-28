// Import Center — shared (client + server) field specifications per entity type.
// Pure module: no DB access, safe to import from client components.
import {
  PROPERTY_TYPES,
  PROPERTY_STATUS,
  UNIT_TYPES,
  UNIT_USAGE,
  UNIT_STATUS,
  PARTY_TYPES,
  RISK_LEVELS,
  PAYMENT_FREQUENCY,
  CONTRACT_STATUS,
  PAYMENT_METHODS,
  INSTALLMENT_STATUS,
  type StatusMeta,
} from "@/lib/constants";

export const IMPORT_ENTITIES: Record<string, { label: string; description: string; icon: string }> = {
  PROPERTIES: { label: "العقارات", description: "عمارات، فلل، مجمعات ومبانٍ تجارية", icon: "🏢" },
  UNITS: { label: "الوحدات", description: "الوحدات مرتبطة برمز العقار", icon: "🚪" },
  OWNERS: { label: "الملاك", description: "بيانات الملاك مع ربط اختياري بالعقار ونسبة الملكية", icon: "👤" },
  TENANTS: { label: "المستأجرون", description: "الأفراد والشركات المستأجرة", icon: "🧑‍💼" },
  CONTRACTS: { label: "العقود", description: "تُنشأ الأقساط تلقائيًا حسب دورية السداد", icon: "📄" },
  INSTALLMENTS: { label: "الدفعات", description: "أقساط يدوية مرتبطة برمز العقد ورقم التسلسل", icon: "🗓️" },
  PAYMENTS: { label: "سندات القبض", description: "تُخصص للقسط المحدد أو لأقدم قسط مفتوح", icon: "💳" },
};

export type ImportEntity = keyof typeof IMPORT_ENTITIES;

export const IMPORT_JOB_STATUS: Record<string, StatusMeta> = {
  PENDING: { label: "قيد الانتظار", tone: "neutral" },
  VALIDATING: { label: "جارٍ التحقق", tone: "info" },
  PREVIEW: { label: "معاينة", tone: "info" },
  COMPLETED: { label: "مكتمل", tone: "success" },
  FAILED: { label: "فشل", tone: "danger" },
};

export type FieldType = "string" | "number" | "int" | "date" | "enum";

export interface FieldSpec {
  key: string;
  label: string;
  required?: boolean;
  type: FieldType;
  /** enum values → Arabic label (accepts key or label in the file) */
  options?: Record<string, string>;
  /** extra header aliases for auto-mapping (lower-cased compare) */
  aliases?: string[];
  example: string;
  help?: string;
}

const toStr = (m: Record<string, string | StatusMeta>): Record<string, string> =>
  Object.fromEntries(Object.entries(m).map(([k, v]) => [k, typeof v === "string" ? v : v.label]));

export const IMPORT_FIELDS: Record<ImportEntity, FieldSpec[]> = {
  PROPERTIES: [
    { key: "code", label: "رمز العقار", type: "string", aliases: ["property code", "propertycode", "الرمز"], example: "PRP-1001", help: "اختياري — يُولّد تلقائيًا إذا تُرك فارغًا" },
    { key: "name", label: "اسم العقار", type: "string", required: true, aliases: ["name", "property", "الاسم", "العقار"], example: "برج النخيل السكني" },
    { key: "type", label: "نوع العقار", type: "enum", options: PROPERTY_TYPES, aliases: ["type", "النوع"], example: "عمارة سكنية" },
    { key: "city", label: "المدينة", type: "string", aliases: ["city"], example: "الرياض" },
    { key: "district", label: "الحي", type: "string", aliases: ["district"], example: "العليا" },
    { key: "street", label: "الشارع", type: "string", aliases: ["street"], example: "شارع التحلية" },
    { key: "deedNumber", label: "رقم الصك", type: "string", aliases: ["deed", "deednumber", "الصك"], example: "310105001234" },
    { key: "landArea", label: "مساحة الأرض", type: "number", aliases: ["landarea"], example: "900" },
    { key: "buildingArea", label: "مساحة البناء", type: "number", aliases: ["buildingarea"], example: "2400" },
    { key: "floors", label: "عدد الأدوار", type: "int", aliases: ["floors"], example: "4" },
    { key: "buildYear", label: "سنة البناء", type: "int", aliases: ["buildyear", "year"], example: "2018" },
    { key: "ownerCode", label: "رمز المالك", type: "string", aliases: ["owner", "ownercode", "المالك"], example: "OWN-0001", help: "اختياري — يربط العقار بمالك حالي بنسبة 100%" },
    { key: "status", label: "الحالة", type: "enum", options: PROPERTY_STATUS as unknown as Record<string, string>, aliases: ["status"], example: "نشط" },
    { key: "notes", label: "ملاحظات", type: "string", aliases: ["notes", "الملاحظات"], example: "" },
  ],
  UNITS: [
    { key: "propertyCode", label: "رمز العقار", type: "string", required: true, aliases: ["property", "propertycode", "العقار"], example: "PRP-0001" },
    { key: "number", label: "رقم الوحدة", type: "string", required: true, aliases: ["unit", "number", "unitnumber", "الوحدة", "الرقم"], example: "A-12" },
    { key: "code", label: "رمز الوحدة", type: "string", aliases: ["unitcode", "الرمز"], example: "UNT-1001", help: "اختياري — يُولّد تلقائيًا" },
    { key: "floor", label: "الدور", type: "string", aliases: ["floor"], example: "2" },
    { key: "type", label: "نوع الوحدة", type: "enum", options: UNIT_TYPES, aliases: ["type", "النوع"], example: "شقة" },
    { key: "usage", label: "الاستخدام", type: "enum", options: UNIT_USAGE, aliases: ["usage"], example: "سكني" },
    { key: "area", label: "المساحة", type: "number", aliases: ["area"], example: "120" },
    { key: "rooms", label: "الغرف", type: "int", aliases: ["rooms", "bedrooms"], example: "3" },
    { key: "bathrooms", label: "دورات المياه", type: "int", aliases: ["bathrooms", "baths"], example: "2" },
    { key: "targetRent", label: "الإيجار المستهدف", type: "number", aliases: ["targetrent", "rent", "الإيجار"], example: "36000" },
    { key: "currentRent", label: "الإيجار الحالي", type: "number", aliases: ["currentrent"], example: "" },
    { key: "status", label: "الحالة", type: "enum", options: UNIT_STATUS as unknown as Record<string, string>, aliases: ["status"], example: "شاغرة" },
    { key: "notes", label: "ملاحظات", type: "string", aliases: ["notes"], example: "" },
  ],
  OWNERS: [
    { key: "code", label: "رمز المالك", type: "string", aliases: ["ownercode", "الرمز"], example: "OWN-1001", help: "اختياري — يُولّد تلقائيًا" },
    { key: "name", label: "الاسم", type: "string", required: true, aliases: ["name", "owner", "المالك"], example: "عبدالله بن سعد العتيبي" },
    { key: "type", label: "النوع", type: "enum", options: PARTY_TYPES, aliases: ["type"], example: "فرد" },
    { key: "nationalId", label: "رقم الهوية", type: "string", aliases: ["nationalid", "id", "الهوية", "رقم الهوية / الإقامة"], example: "1012345678" },
    { key: "crNumber", label: "السجل التجاري", type: "string", aliases: ["cr", "crnumber", "السجل"], example: "" },
    { key: "phone", label: "الجوال", type: "string", aliases: ["phone", "mobile", "الهاتف", "رقم الجوال"], example: "0501234567" },
    { key: "email", label: "البريد الإلكتروني", type: "string", aliases: ["email", "البريد"], example: "owner@example.com" },
    { key: "iban", label: "الآيبان", type: "string", aliases: ["iban"], example: "SA0380000000608010167519" },
    { key: "bankName", label: "البنك", type: "string", aliases: ["bank", "bankname"], example: "الراجحي" },
    { key: "managementFeePct", label: "نسبة الإدارة %", type: "number", aliases: ["fee", "managementfee", "نسبة الإدارة"], example: "5" },
    { key: "propertyCode", label: "رمز العقار", type: "string", aliases: ["property", "propertycode", "العقار"], example: "PRP-0001", help: "اختياري — يربط المالك بالعقار" },
    { key: "ownershipPct", label: "نسبة الملكية %", type: "number", aliases: ["ownership", "percentage", "نسبة الملكية"], example: "100" },
    { key: "notes", label: "ملاحظات", type: "string", aliases: ["notes"], example: "" },
  ],
  TENANTS: [
    { key: "code", label: "رمز المستأجر", type: "string", aliases: ["tenantcode", "الرمز"], example: "TNT-1001", help: "اختياري — يُولّد تلقائيًا" },
    { key: "name", label: "الاسم", type: "string", required: true, aliases: ["name", "tenant", "المستأجر"], example: "محمد بن أحمد القحطاني" },
    { key: "type", label: "النوع", type: "enum", options: PARTY_TYPES, aliases: ["type"], example: "فرد" },
    { key: "nationalId", label: "رقم الهوية", type: "string", aliases: ["nationalid", "id", "الهوية", "رقم الهوية / الإقامة"], example: "1098765432" },
    { key: "idExpiry", label: "انتهاء الهوية", type: "date", aliases: ["idexpiry"], example: "2027-05-01" },
    { key: "crNumber", label: "السجل التجاري", type: "string", aliases: ["cr", "crnumber"], example: "" },
    { key: "phone", label: "الجوال", type: "string", aliases: ["phone", "mobile", "الهاتف", "رقم الجوال"], example: "0559876543" },
    { key: "email", label: "البريد الإلكتروني", type: "string", aliases: ["email"], example: "tenant@example.com" },
    { key: "employer", label: "جهة العمل", type: "string", aliases: ["employer", "company"], example: "شركة أرامكو" },
    { key: "riskLevel", label: "مستوى المخاطر", type: "enum", options: RISK_LEVELS as unknown as Record<string, string>, aliases: ["risk", "risklevel"], example: "منخفض" },
    { key: "notes", label: "ملاحظات", type: "string", aliases: ["notes"], example: "" },
  ],
  CONTRACTS: [
    { key: "code", label: "رمز العقد", type: "string", aliases: ["contractcode", "contract", "الرمز", "العقد"], example: "CNT-1001", help: "اختياري — يُولّد تلقائيًا" },
    { key: "unitCode", label: "رمز الوحدة", type: "string", required: true, aliases: ["unit", "unitcode", "الوحدة"], example: "UNT-0001" },
    { key: "tenantCode", label: "رمز المستأجر", type: "string", required: true, aliases: ["tenant", "tenantcode", "المستأجر"], example: "TNT-0001", help: "يمكن استخدام رقم الهوية بدلًا من الرمز" },
    { key: "startDate", label: "تاريخ البداية", type: "date", required: true, aliases: ["start", "startdate", "البداية"], example: "2025-01-01" },
    { key: "endDate", label: "تاريخ النهاية", type: "date", required: true, aliases: ["end", "enddate", "النهاية"], example: "2025-12-31" },
    { key: "totalAmount", label: "قيمة العقد", type: "number", required: true, aliases: ["amount", "total", "totalamount", "القيمة", "الإيجار السنوي"], example: "48000" },
    { key: "paymentFrequency", label: "دورية السداد", type: "enum", options: PAYMENT_FREQUENCY, aliases: ["frequency", "paymentfrequency", "الدورية"], example: "ربع سنوي" },
    { key: "installmentsCount", label: "عدد الأقساط", type: "int", aliases: ["installments", "installmentscount"], example: "4", help: "يُستخدم عند الدورية «مخصص»" },
    { key: "managementFeePct", label: "نسبة الإدارة %", type: "number", aliases: ["fee", "managementfee"], example: "5" },
    { key: "status", label: "الحالة", type: "enum", options: CONTRACT_STATUS as unknown as Record<string, string>, aliases: ["status"], example: "نشط" },
    { key: "notes", label: "ملاحظات", type: "string", aliases: ["notes"], example: "" },
  ],
  INSTALLMENTS: [
    { key: "contractCode", label: "رمز العقد", type: "string", required: true, aliases: ["contract", "contractcode", "العقد"], example: "CNT-0001" },
    { key: "seq", label: "رقم القسط", type: "int", required: true, aliases: ["seq", "sequence", "installment", "القسط", "التسلسل"], example: "1" },
    { key: "dueDate", label: "تاريخ الاستحقاق", type: "date", required: true, aliases: ["due", "duedate", "الاستحقاق"], example: "2025-01-01" },
    { key: "amount", label: "المبلغ", type: "number", required: true, aliases: ["amount", "المبلغ"], example: "12000" },
    { key: "paidAmount", label: "المدفوع", type: "number", aliases: ["paid", "paidamount", "المدفوع"], example: "0", help: "للأرصدة الافتتاحية فقط — لا يُنشئ دفعة" },
    { key: "status", label: "الحالة", type: "enum", options: INSTALLMENT_STATUS as unknown as Record<string, string>, aliases: ["status"], example: "", help: "اختياري — تُحسب تلقائيًا" },
  ],
  PAYMENTS: [
    { key: "code", label: "رمز الدفعة", type: "string", aliases: ["paymentcode", "الرمز"], example: "PAY-1001", help: "اختياري — يُولّد تلقائيًا" },
    { key: "contractCode", label: "رمز العقد", type: "string", required: true, aliases: ["contract", "contractcode", "العقد"], example: "CNT-0001" },
    { key: "seq", label: "رقم القسط", type: "int", aliases: ["seq", "installment", "القسط"], example: "1", help: "اختياري — إن تُرك فارغًا تُخصص لأقدم قسط مفتوح" },
    { key: "paidAt", label: "تاريخ الدفع", type: "date", required: true, aliases: ["date", "paidat", "التاريخ"], example: "2025-01-03" },
    { key: "amount", label: "المبلغ", type: "number", required: true, aliases: ["amount", "المبلغ"], example: "12000" },
    { key: "method", label: "طريقة الدفع", type: "enum", options: PAYMENT_METHODS, aliases: ["method", "الطريقة"], example: "تحويل بنكي" },
    { key: "reference", label: "المرجع", type: "string", aliases: ["reference", "ref", "المرجع", "رقم الحوالة"], example: "TRF552901" },
    { key: "bank", label: "البنك", type: "string", aliases: ["bank"], example: "الراجحي" },
    { key: "notes", label: "ملاحظات", type: "string", aliases: ["notes"], example: "" },
  ],
};

/** Normalize a header/alias for comparison. */
export function normHeader(s: string) {
  return s
    .replace(/﻿/g, "")
    .trim()
    .toLowerCase()
    .replace(/[_\-\s]+/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/^ال/, "");
}

/** Auto-map file headers to target field keys by label/key/aliases. */
export function autoMap(entity: ImportEntity, headers: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  const used = new Set<string>();
  const normalized = headers.map((h) => normHeader(h));
  for (const f of IMPORT_FIELDS[entity]) {
    const candidates = [f.label, f.key, ...(f.aliases ?? [])].map(normHeader);
    let idx = normalized.findIndex((h, i) => !used.has(headers[i]) && candidates.includes(h));
    if (idx < 0) idx = normalized.findIndex((h, i) => !used.has(headers[i]) && h && candidates.some((c) => c.length > 2 && (h.includes(c) || c.includes(h))));
    if (idx >= 0) {
      map[f.key] = headers[idx];
      used.add(headers[idx]);
    }
  }
  return map;
}

/** Arabic-Indic digits → Latin, strip thousands separators & currency. */
export function normalizeNumber(v: string): number | null {
  const s = v
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/[,\s]/g, "")
    .replace(/ر\.?س|sar|ريال/gi, "")
    .replace(/٫/g, ".")
    .trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Accepts yyyy-mm-dd, yyyy/mm/dd, dd/mm/yyyy, dd-mm-yyyy, and Excel serial numbers. */
export function normalizeDate(v: string): Date | null {
  const s = v.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return mk(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  if (m) return mk(+m[3], +m[2], +m[1]);
  if (/^\d{5}$/.test(s)) {
    // Excel serial date
    const d = new Date(Date.UTC(1899, 11, 30) + Number(s) * 86400000);
    return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function mk(y: number, mo: number, d: number) {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  // Stored like <input type=date> values: UTC midnight (the same Riyadh calendar day).
  const x = new Date(Date.UTC(y, mo - 1, d));
  return x.getUTCMonth() === mo - 1 && x.getUTCDate() === d ? x : null;
}

/** Enum: accepts key (any case) or Arabic label. */
export function normalizeEnum(v: string, options: Record<string, string>): string | null {
  const s = v.trim();
  if (!s) return null;
  const up = s.toUpperCase().replace(/[\s-]+/g, "_");
  if (options[up] !== undefined) return up;
  const n = normHeader(s);
  for (const [k, label] of Object.entries(options)) if (normHeader(label) === n) return k;
  return null;
}

export interface RowResult {
  row: number;
  ok: boolean;
  errors: string[];
  /** human-readable preview of key fields */
  preview: Record<string, string>;
}

export interface ImportReport {
  jobId: string;
  total: number;
  success: number;
  failed: number;
  errors: { row: number; message: string }[];
  created: string[];
}
