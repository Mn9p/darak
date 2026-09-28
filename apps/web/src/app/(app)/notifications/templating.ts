// Shared (server + client) template variable dictionary and renderer.

export const TEMPLATE_VARS: { key: string; label: string; sample: string }[] = [
  { key: "tenant_name", label: "اسم المستأجر", sample: "محمد العتيبي" },
  { key: "unit_number", label: "رقم الوحدة", sample: "A-12" },
  { key: "amount", label: "المبلغ", sample: "15,000" },
  { key: "due_date", label: "تاريخ الاستحقاق", sample: "2025-10-01" },
  { key: "end_date", label: "تاريخ انتهاء العقد", sample: "2025-12-31" },
  { key: "owner_name", label: "اسم المالك", sample: "شركة الرواد العقارية" },
  { key: "property_name", label: "اسم العقار", sample: "برج النخيل" },
  { key: "office_name", label: "اسم المكتب", sample: "دارك للعقارات" },
];

export function renderTemplate(body: string, values?: Record<string, string>) {
  const v = values ?? Object.fromEntries(TEMPLATE_VARS.map((t) => [t.key, t.sample]));
  return body.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_m, k: string) => v[k] ?? `{{${k}}}`);
}
