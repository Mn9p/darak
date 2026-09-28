"use client";

import { useActionState } from "react";
import { Field, Input, Select, Textarea, FormGrid, Alert, type FormState } from "@/components/ui";
import { createPdplRequest } from "./actions";

const TYPES: Record<string, string> = {
  "الاطلاع": "طلب الاطلاع على البيانات",
  "التصحيح": "طلب تصحيح البيانات",
  "الحذف": "طلب حذف / إتلاف البيانات",
  "سحب الموافقة": "سحب الموافقة على المعالجة",
  "نقل البيانات": "طلب نسخة قابلة للنقل",
};

export function PdplForm() {
  const [state, formAction, pending] = useActionState<FormState, FormData>(createPdplRequest, null);
  return (
    <form action={formAction} className="space-y-3">
      {state?.error && <Alert tone="danger">{state.error}</Alert>}
      {state?.success && <Alert tone="success">{state.success}</Alert>}
      <FormGrid cols={2}>
        <Field label="نوع الطلب" name="type" required>
          <Select name="type" options={TYPES} />
        </Field>
        <Field label="صاحب البيانات" name="subject" required help="اسم المالك أو المستأجر أو الموظف">
          <Input name="subject" required placeholder="مثال: محمد القحطاني" />
        </Field>
      </FormGrid>
      <Field label="تفاصيل الطلب" name="body" required>
        <Textarea name="body" rows={3} required placeholder="البيانات المعنية وطريقة التحقق من هوية مقدم الطلب" />
      </Field>
      <div className="flex justify-end">
        <button type="submit" className="btn btn-primary btn-sm" disabled={pending}>
          {pending ? "جارٍ الإرسال…" : "تسجيل الطلب"}
        </button>
      </div>
    </form>
  );
}
