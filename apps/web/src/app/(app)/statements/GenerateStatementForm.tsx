"use client";


import { keepFormValues } from "@/lib/keep-form";
import { useActionState, useMemo, useState } from "react";
import { Field, Input, Select, Alert, type FormState } from "@/components/ui";

type PropertyOpt = { id: string; name: string; ownerIds: string[] };

export function GenerateStatementForm({
  action,
  owners,
  properties,
  defaultOwnerId,
  defaultPropertyId,
  defaultPeriod,
}: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  owners: { id: string; name: string }[];
  properties: PropertyOpt[];
  defaultOwnerId?: string;
  defaultPropertyId?: string;
  defaultPeriod: string;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, null);
  const [ownerId, setOwnerId] = useState(defaultOwnerId ?? "");
  const ownerProps = useMemo(() => properties.filter((p) => !ownerId || p.ownerIds.includes(ownerId)), [properties, ownerId]);

  return (
    <form onSubmit={keepFormValues(formAction)} className="space-y-3">
      {state?.error && <Alert tone="danger">{state.error}</Alert>}
      <div className="flex flex-wrap items-end gap-2">
        <Field label="المالك" name="ownerId" required className="min-w-[200px]">
          <Select name="ownerId" options={owners.map((o) => ({ value: o.id, label: o.name }))} placeholder="اختر المالك" value={ownerId} onChange={(e) => setOwnerId(e.target.value)} required />
        </Field>
        <Field label="الشهر" name="period" required>
          <Input name="period" type="month" defaultValue={defaultPeriod} required className="!w-40" />
        </Field>
        <Field label="العقار" name="propertyId" className="min-w-[200px]">
          <Select name="propertyId" options={ownerProps.map((p) => ({ value: p.id, label: p.name }))} placeholder="كل عقارات المالك" defaultValue={defaultPropertyId ?? ""} />
        </Field>
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "جارٍ الاحتساب…" : "إنشاء كشف حساب"}
        </button>
      </div>
      <p className="help">تُحتسب الأرقام من الدفعات المحصلة والمصروفات المعتمدة خلال الشهر، وتُنشأ كمسودة قابلة للمراجعة.</p>
    </form>
  );
}
