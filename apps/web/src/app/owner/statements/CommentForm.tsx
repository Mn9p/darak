"use client";

import { useActionState } from "react";
import { Field, Textarea, Alert, type FormState } from "@/components/ui";

export function StatementCommentForm({ action, statementId }: { action: (prev: FormState, fd: FormData) => Promise<FormState>; statementId: string }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, null);
  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="id" value={statementId} />
      {state?.error && <Alert tone="danger">{state.error}</Alert>}
      {state?.success && <Alert tone="success">{state.success}</Alert>}
      <Field label="ملاحظتك" name="comment" required help="مثال: استفسار عن مصروف، أو طلب توضيح لمبلغ محصّل.">
        <Textarea name="comment" rows={4} required placeholder="اكتب ملاحظتك على هذا الكشف…" />
      </Field>
      <button type="submit" className="btn btn-primary btn-sm w-full" disabled={pending}>
        {pending ? "جارٍ الإرسال…" : "إرسال الملاحظة للمكتب"}
      </button>
    </form>
  );
}
