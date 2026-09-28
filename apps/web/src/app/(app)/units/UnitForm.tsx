"use client";



import { asciiDigits } from "@/lib/phone";
import { keepFormValues } from "@/lib/keep-form";
import { useActionState, useState } from "react";
import Link from "next/link";
import { Field, Input, Select, Textarea, FormGrid, FormActions, Alert, Card, type FormState } from "@/components/ui";
import { Optional } from "@/components/MoreMenu";
import { UNIT_TYPES, UNIT_USAGE, UNIT_STATUS } from "@/lib/constants";

type Opt = { id: string; name: string };

export function UnitForm({
  action,
  unit,
  properties,
  hasActiveContract,
}: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  unit?: Record<string, unknown> | null;
  properties: Opt[];
  /** RENTED can only be chosen when the unit already has an active contract. */
  hasActiveContract?: boolean;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, null);
  const u = (unit ?? {}) as Record<string, string | number | null>;
  const isEdit = Boolean(unit?.id);
  const hasExtras = Boolean(u.floor || u.area || u.rooms || u.bathrooms || u.currentRent || u.tags || u.notes);
  // New only: "single number" or "range of numbers" (one unit per number, same type / rent / floor).
  const [mode, setMode] = useState<"single" | "range">("single");
  const [rangeFrom, setRangeFrom] = useState("");
  const [rangeTo, setRangeTo] = useState("");
  const rf = asciiDigits(rangeFrom).trim();
  const rt = asciiDigits(rangeTo).trim();
  const rangeCount = /^\d+$/.test(rf) && /^\d+$/.test(rt) && Number(rt) >= Number(rf) ? Number(rt) - Number(rf) + 1 : 0;

  const statusOptions = Object.entries(UNIT_STATUS)
    .filter(([k]) => k !== "ARCHIVED" && (k !== "RENTED" || hasActiveContract))
    .map(([value, v]) => ({ value, label: v.label }));

  return (
    <form onSubmit={keepFormValues(formAction)} className="space-y-4">
      {isEdit ? <input type="hidden" name="id" value={String(unit!.id)} /> : null}
      {state?.error && <Alert tone="danger">{state.error}</Alert>}

      <Card
        title="الوحدة"
        actions={
          !isEdit ? (
            <div className="flex items-center gap-3 text-[12.5px] font-semibold text-text-2">
              <label className="flex items-center gap-1.5">
                <input type="radio" name="mode" value="single" checked={mode === "single"} onChange={() => setMode("single")} /> وحدة واحدة
              </label>
              <label className="flex items-center gap-1.5">
                <input type="radio" name="mode" value="range" checked={mode === "range"} onChange={() => setMode("range")} /> نطاق أرقام
              </label>
            </div>
          ) : undefined
        }
      >
        <FormGrid cols={3}>
          <Field label="العقار" name="propertyId" required help={isEdit && hasActiveContract ? "لا يمكن نقل وحدة مرتبطة بعقد نشط." : undefined}>
            <Select name="propertyId" options={properties.map((p) => ({ value: p.id, label: p.name }))} placeholder="اختر العقار" defaultValue={u.propertyId ?? ""} required disabled={Boolean(isEdit && hasActiveContract)} />
            {isEdit && hasActiveContract && <input type="hidden" name="propertyId" value={String(u.propertyId ?? "")} />}
          </Field>
          {isEdit || mode === "single" ? (
            <Field label="رقم الوحدة" name="number" required>
              <Input name="number" className="ltr" defaultValue={u.number ?? ""} required placeholder="مثال: 101" />
            </Field>
          ) : (
            <Field label="نطاق الأرقام" name="rangeFrom" required help={rangeCount > 0 ? `ستُنشأ ${rangeCount} وحدة بنفس النوع والإيجار والدور. الأرقام المسجلة مسبقًا تُتخطى.` : "من رقم إلى رقم، حتى 200 وحدة."}>
              <div className="grid grid-cols-2 gap-2">
                <Input name="rangeFrom" className="ltr" inputMode="numeric" value={rangeFrom} onChange={(e) => setRangeFrom(e.target.value)} required placeholder="من رقم: 101" aria-label="من رقم" />
                <Input name="rangeTo" className="ltr" inputMode="numeric" value={rangeTo} onChange={(e) => setRangeTo(e.target.value)} required placeholder="إلى رقم: 120" aria-label="إلى رقم" />
              </div>
            </Field>
          )}
          <Field label="النوع" name="type" required>
            <Select name="type" options={UNIT_TYPES} defaultValue={u.type ?? "APARTMENT"} />
          </Field>
          <Field label="الاستخدام" name="usage" required>
            <Select name="usage" options={UNIT_USAGE} defaultValue={u.usage ?? "RESIDENTIAL"} />
          </Field>
          <Field label="الإيجار المستهدف (سنوي)" name="targetRent">
            <Input name="targetRent" type="number" step="0.01" min={0} defaultValue={u.targetRent ?? ""} />
          </Field>
          <Field label="الحالة" name="status" help={hasActiveContract ? "حالة «مؤجرة» تُدار من العقد." : undefined}>
            <Select name="status" options={statusOptions} defaultValue={u.status ?? "VACANT"} />
          </Field>
        </FormGrid>
      </Card>

      <Optional title="خيارات إضافية" open={hasExtras}>
        <FormGrid cols={3}>
          <Field label="الدور" name="floor">
            <Input name="floor" className="ltr" defaultValue={u.floor ?? ""} />
          </Field>
          <Field label="المساحة (م²)" name="area">
            <Input name="area" type="number" step="0.01" min={0} defaultValue={u.area ?? ""} />
          </Field>
          <Field label="الإيجار الحالي (سنوي)" name="currentRent" help="يُحدَّث عادةً من العقد النشط.">
            <Input name="currentRent" type="number" step="0.01" min={0} defaultValue={u.currentRent ?? ""} />
          </Field>
          <Field label="عدد الغرف" name="rooms">
            <Input name="rooms" type="number" min={0} defaultValue={u.rooms ?? ""} />
          </Field>
          <Field label="دورات المياه" name="bathrooms">
            <Input name="bathrooms" type="number" min={0} defaultValue={u.bathrooms ?? ""} />
          </Field>
          <Field label="الوسوم" name="tags" help="افصل بينها بفاصلة">
            <Input name="tags" defaultValue={u.tags ?? ""} />
          </Field>
        </FormGrid>
        <div className="mt-4">
          <Field label="ملاحظات" name="notes">
            <Textarea name="notes" defaultValue={u.notes ?? ""} />
          </Field>
        </div>
      </Optional>

      <FormActions>
        <Link href={isEdit ? `/units/${unit!.id}` : u.propertyId ? `/properties/${u.propertyId}?tab=units` : "/units"} className="btn btn-ghost">
          إلغاء
        </Link>
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "جارٍ الحفظ…" : isEdit ? "حفظ" : mode === "range" && rangeCount > 0 ? `إضافة ${rangeCount} وحدة` : "إضافة وحدة"}
        </button>
      </FormActions>
    </form>
  );
}
