"use client";


import { keepFormValues } from "@/lib/keep-form";
import { useActionState } from "react";
import Link from "next/link";
import { Field, Input, FormGrid, FormActions, Alert, type FormState } from "@/components/ui";
import { Optional } from "@/components/MoreMenu";
import { CITIES } from "@/lib/constants";

export function BranchForm({ action, branch }: { action: (prev: FormState, fd: FormData) => Promise<FormState>; branch?: { id: string; name: string; city: string | null; address: string | null; phone: string | null } | null }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, null);
  const hasExtras = Boolean(branch?.address || branch?.phone);
  return (
    <form onSubmit={keepFormValues(formAction)} className="space-y-3">
      {branch?.id && <input type="hidden" name="id" value={branch.id} />}
      {state?.error && <Alert tone="danger">{state.error}</Alert>}
      <FormGrid cols={1}>
        <Field label="اسم الفرع" name="name" required>
          <Input name="name" defaultValue={branch?.name ?? ""} required placeholder="مثال: فرع الرياض" />
        </Field>
        <Field label="المدينة" name="city">
          <Input name="city" list="branch-cities" defaultValue={branch?.city ?? ""} />
          <datalist id="branch-cities">
            {CITIES.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </Field>
      </FormGrid>
      <Optional title="خيارات إضافية" open={hasExtras}>
        <FormGrid cols={1}>
          <Field label="العنوان" name="address">
            <Input name="address" defaultValue={branch?.address ?? ""} />
          </Field>
          <Field label="الهاتف" name="phone">
            <Input name="phone" type="tel" defaultValue={branch?.phone ?? ""} />
          </Field>
        </FormGrid>
      </Optional>
      <FormActions>
        {branch?.id && (
          <Link href="/settings/branches" className="btn btn-ghost">
            إلغاء
          </Link>
        )}
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "جارٍ الحفظ…" : branch?.id ? "حفظ" : "إضافة الفرع"}
        </button>
      </FormActions>
    </form>
  );
}
