"use client";


import { keepFormValues } from "@/lib/keep-form";
import { useActionState } from "react";
import { Field, Input, Select, FormGrid, Alert, type FormState } from "@/components/ui";
import { PLANS, ORG_STATUS } from "@/lib/constants";

export function OrgLimitsForm({
  action,
  org,
}: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  org: { id: string; plan: string; status: string; unitsLimit: number; usersLimit: number; renewalDate: string };
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, null);
  const planOptions = Object.entries(PLANS).map(([value, p]) => ({ value, label: p.label }));
  return (
    <form onSubmit={keepFormValues(formAction)} className="space-y-3">
      <input type="hidden" name="id" value={org.id} />
      {state?.error && <Alert tone="danger">{state.error}</Alert>}
      {state?.success && <Alert tone="success">{state.success}</Alert>}
      <FormGrid cols={2}>
        <Field label="الخطة" name="plan">
          <Select name="plan" options={planOptions} defaultValue={org.plan} />
        </Field>
        <Field label="الحالة" name="status" help="الإيقاف يمنع دخول جميع مستخدمي المكتب">
          <Select name="status" options={ORG_STATUS} defaultValue={org.status} />
        </Field>
        <Field label="حد الوحدات" name="unitsLimit">
          <Input name="unitsLimit" type="number" min={1} defaultValue={org.unitsLimit} />
        </Field>
        <Field label="حد المستخدمين" name="usersLimit">
          <Input name="usersLimit" type="number" min={1} defaultValue={org.usersLimit} />
        </Field>
        <Field label="تاريخ التجديد" name="renewalDate" className="md:col-span-2">
          <Input name="renewalDate" type="date" defaultValue={org.renewalDate} />
        </Field>
      </FormGrid>
      <div className="flex justify-end">
        <button type="submit" className="btn btn-primary btn-sm" disabled={pending}>
          {pending ? "جارٍ الحفظ…" : "حفظ التغييرات"}
        </button>
      </div>
    </form>
  );
}
