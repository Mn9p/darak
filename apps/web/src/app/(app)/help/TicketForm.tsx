"use client";

import { useActionState } from "react";
import { Field, Input, Select, Textarea, FormGrid, Alert, type FormState } from "@/components/ui";
import { TASK_PRIORITY } from "@/lib/constants";
import { createTicket } from "./actions";

export function TicketForm() {
  const [state, formAction, pending] = useActionState<FormState, FormData>(createTicket, null);
  return (
    <form action={formAction} className="space-y-3">
      {state?.error && <Alert tone="danger">{state.error}</Alert>}
      {state?.success && <Alert tone="success">{state.success}</Alert>}
      <FormGrid cols={3}>
        <Field label="العنوان" name="subject" required className="md:col-span-2">
          <Input name="subject" required placeholder="مثال: خطأ في احتساب نسبة الإدارة" />
        </Field>
        <Field label="الأولوية" name="priority">
          <Select name="priority" options={TASK_PRIORITY} defaultValue="MEDIUM" />
        </Field>
      </FormGrid>
      <Field label="التفاصيل" name="body" required help="اذكر الخطوات، الصفحة، ورقم السجل إن وجد">
        <Textarea name="body" rows={4} required />
      </Field>
      <div className="flex justify-end">
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "جارٍ الإرسال…" : "إرسال"}
        </button>
      </div>
    </form>
  );
}
