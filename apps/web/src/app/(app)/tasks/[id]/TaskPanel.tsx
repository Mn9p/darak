"use client";

import { useActionState } from "react";
import { Field, Select, Textarea, Alert, type FormState } from "@/components/ui";
import { reassignTask, addTaskComment } from "../actions";

type Opt = { id: string; name: string };

export function TaskPanel({ taskId, assignedToId, assignees, canManage, terminal }: { taskId: string; assignedToId: string | null; assignees: Opt[]; canManage: boolean; terminal: boolean }) {
  const [reState, reAction, rePending] = useActionState<FormState, FormData>(reassignTask, null);
  const [cState, cAction, cPending] = useActionState<FormState, FormData>(addTaskComment, null);
  return (
    <div className="space-y-4">
      {canManage && !terminal && (
        <section className="card px-5 py-4">
          <h3 className="mb-3 text-[15px] font-bold text-brand">الإسناد</h3>
          <form action={reAction} className="space-y-3">
            <input type="hidden" name="id" value={taskId} />
            {reState?.error && <Alert tone="danger">{reState.error}</Alert>}
            {reState?.success && <Alert tone="success">{reState.success}</Alert>}
            <Field label="المسؤول" name="assignedToId">
              <Select name="assignedToId" options={assignees.map((a) => ({ value: a.id, label: a.name }))} placeholder="غير مسندة" defaultValue={assignedToId ?? ""} />
            </Field>
            <button type="submit" className="btn btn-outline btn-sm" disabled={rePending}>
              {rePending ? "جارٍ الحفظ…" : "حفظ"}
            </button>
          </form>
        </section>
      )}
      <section className="card px-5 py-4">
        <h3 className="mb-3 text-[15px] font-bold text-brand">إضافة تعليق</h3>
        <form action={cAction} className="space-y-3">
          <input type="hidden" name="id" value={taskId} />
          {cState?.error && <Alert tone="danger">{cState.error}</Alert>}
          {cState?.success && <Alert tone="success">{cState.success}</Alert>}
          <Textarea name="comment" rows={3} placeholder="تحديث أو ملاحظة للفريق" />
          <button type="submit" className="btn btn-outline btn-sm" disabled={cPending}>
            {cPending ? "جارٍ الإرسال…" : "إرسال"}
          </button>
        </form>
      </section>
    </div>
  );
}
