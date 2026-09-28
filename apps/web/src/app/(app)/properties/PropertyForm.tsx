"use client";


import { keepFormValues } from "@/lib/keep-form";
import { useActionState, useState } from "react";
import Link from "next/link";
import { Field, Input, Select, Textarea, FormGrid, FormActions, Alert, Card, type FormState } from "@/components/ui";
import { Optional } from "@/components/MoreMenu";
import { PROPERTY_TYPES, PROPERTY_STATUS, CITIES } from "@/lib/constants";

type Opt = { id: string; name: string };

export function PropertyForm({
  action,
  property,
  branches,
  managers,
  owners,
  ownerships,
  customFieldKeys,
}: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  property?: Record<string, unknown> | null;
  branches: Opt[];
  managers: Opt[];
  owners: Opt[];
  ownerships?: { ownerId: string; percentage: number }[];
  customFieldKeys?: string[];
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, null);
  const p = (property ?? {}) as Record<string, string | number | null>;
  const cf = (property?.customFields ? JSON.parse(String(property.customFields)) : {}) as Record<string, string>;
  const [rows, setRows] = useState<{ ownerId: string; percentage: number }[]>(ownerships?.length ? ownerships : [{ ownerId: "", percentage: 100 }]);
  const total = rows.reduce((s, r) => s + (Number(r.percentage) || 0), 0);
  const isEdit = Boolean(property?.id);
  const hasExtras = Boolean(p.street || p.nationalAddress || p.deedNumber || p.landArea || p.buildingArea || p.floors || p.buildYear || p.notes);

  return (
    <form onSubmit={keepFormValues(formAction)} className="space-y-4">
      {isEdit ? <input type="hidden" name="id" value={String(property!.id)} /> : null}
      {state?.error && <Alert tone="danger">{state.error}</Alert>}

      <Card title="العقار">
        <FormGrid cols={2}>
          <Field label="اسم العقار" name="name" required>
            <Input name="name" defaultValue={p.name ?? ""} required placeholder="مثال: برج النخيل" />
          </Field>
          <Field label="النوع" name="type" required>
            <Select name="type" options={PROPERTY_TYPES} defaultValue={p.type ?? "RESIDENTIAL_BUILDING"} />
          </Field>
          <Field label="المدينة" name="city">
            <Input name="city" list="cities" defaultValue={p.city ?? ""} />
            <datalist id="cities">
              {CITIES.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </Field>
          <Field label="الحي" name="district">
            <Input name="district" defaultValue={p.district ?? ""} />
          </Field>
        </FormGrid>

        <div className="mt-5 border-t border-line pt-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="label">
              المالك
              {owners.length > 0 && (
                <>
                  {" "}
                  <Link href="/owners/new" className="link text-[12.5px] font-normal">
                    إضافة مالك جديد
                  </Link>
                </>
              )}
            </span>
            {rows.length > 1 && <span className={`num text-[12.5px] font-bold ${Math.abs(total - 100) < 0.01 ? "text-success" : "text-danger"}`}>المجموع {total}%</span>}
          </div>
          {owners.length === 0 && (
            <div className="mb-3">
              <Alert tone="warning">
                لا يوجد ملاك مسجلون بعد. يمكنك حفظ العقار الآن وربطه لاحقًا، أو{" "}
                <Link href="/owners/new" className="link font-bold">
                  أضف المالك أولًا
                </Link>
                .
              </Alert>
            </div>
          )}
          <div className="space-y-2">
            {rows.map((r, i) => (
              <div key={i} className={`grid items-end gap-2 ${rows.length > 1 ? "grid-cols-1 sm:grid-cols-[1fr_110px_40px]" : "grid-cols-1"}`}>
                <Select name={`owner_${i}_id`} options={owners.map((o) => ({ value: o.id, label: o.name }))} placeholder={owners.length ? "اختر المالك" : "لا يوجد ملاك بعد"} value={r.ownerId} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, ownerId: e.target.value } : x)))} required={owners.length > 0} disabled={owners.length === 0} />
                {rows.length > 1 ? (
                  <>
                    <Input name={`owner_${i}_pct`} type="number" min={0} max={100} step="0.01" value={r.percentage} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, percentage: Number(e.target.value) } : x)))} aria-label="النسبة %" />
                    <button type="button" className="btn btn-ghost btn-sm !px-2" onClick={() => setRows(rows.filter((_, j) => j !== i))} aria-label="حذف">
                      ×
                    </button>
                  </>
                ) : (
                  <input type="hidden" name={`owner_${i}_pct`} value={100} />
                )}
              </div>
            ))}
          </div>
          {owners.length > 0 && (
            <button type="button" className="btn btn-link btn-sm mt-1 !px-0" onClick={() => rows.length < 6 && setRows([...rows, { ownerId: "", percentage: 0 }])}>
              إضافة مالك شريك
            </button>
          )}
        </div>
      </Card>

      <Optional title="الموقع والمواصفات" open={hasExtras}>
        <FormGrid cols={3}>
          <Field label="الشارع" name="street">
            <Input name="street" defaultValue={p.street ?? ""} />
          </Field>
          <Field label="العنوان الوطني" name="nationalAddress">
            <Input name="nationalAddress" defaultValue={p.nationalAddress ?? ""} />
          </Field>
          <Field label="رقم الصك" name="deedNumber">
            <Input name="deedNumber" className="ltr" defaultValue={p.deedNumber ?? ""} />
          </Field>
          <Field label="مساحة الأرض (م²)" name="landArea">
            <Input name="landArea" type="number" min={0} step="0.01" defaultValue={p.landArea ?? ""} />
          </Field>
          <Field label="مساحة البناء (م²)" name="buildingArea">
            <Input name="buildingArea" type="number" min={0} step="0.01" defaultValue={p.buildingArea ?? ""} />
          </Field>
          <Field label="عدد الأدوار" name="floors">
            <Input name="floors" type="number" min={0} max={200} step={1} defaultValue={p.floors ?? ""} />
          </Field>
          <Field label="سنة البناء" name="buildYear">
            <Input name="buildYear" type="number" min={1900} max={2100} step={1} defaultValue={p.buildYear ?? ""} />
          </Field>
        </FormGrid>
        <div className="mt-4">
          <Field label="ملاحظات" name="notes">
            <Textarea name="notes" defaultValue={p.notes ?? ""} />
          </Field>
        </div>
      </Optional>

      <Optional title="خيارات إضافية">
        <FormGrid cols={3}>
          <Field label="الحالة" name="status">
            <Select name="status" options={PROPERTY_STATUS} defaultValue={p.status ?? "ACTIVE"} />
          </Field>
          <Field label="الفرع" name="branchId">
            <Select name="branchId" options={branches.map((b) => ({ value: b.id, label: b.name }))} placeholder="بدون" defaultValue={p.branchId ?? ""} />
          </Field>
          <Field label="مدير العقار" name="managerId">
            <Select name="managerId" options={managers.map((b) => ({ value: b.id, label: b.name }))} placeholder="غير محدد" defaultValue={p.managerId ?? ""} />
          </Field>
          <Field label="الوسوم" name="tags" help="افصل بينها بفاصلة">
            <Input name="tags" defaultValue={p.tags ?? ""} />
          </Field>
          {(customFieldKeys?.length ? customFieldKeys : ["رقم داخلي", "تصنيف داخلي", "مدير المنطقة"]).map((k) => (
            <Field key={k} label={k} name={`cf_${k}`}>
              <Input name={`cf_${k}`} defaultValue={cf[k] ?? ""} />
            </Field>
          ))}
        </FormGrid>
      </Optional>

      <FormActions>
        <Link href={isEdit ? `/properties/${property!.id}` : "/properties"} className="btn btn-ghost">
          إلغاء
        </Link>
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "جارٍ الحفظ…" : isEdit ? "حفظ" : "إضافة عقار"}
        </button>
      </FormActions>
    </form>
  );
}
