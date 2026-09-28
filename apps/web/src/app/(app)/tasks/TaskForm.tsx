"use client";


import { keepFormValues } from "@/lib/keep-form";
import { useActionState, useState } from "react";
import Link from "next/link";
import { Field, Input, Select, Textarea, FormGrid, FormActions, Alert, Card, type FormState } from "@/components/ui";
import { Optional } from "@/components/MoreMenu";
import { TASK_PRIORITY, ENTITY_ROUTES, ENTITY_TYPES } from "@/lib/constants";

type Opt = { id: string; name: string };
type Item = { text: string; done: boolean };

const TASK_ENTITY_TYPES = Object.fromEntries(Object.keys(ENTITY_ROUTES).filter((k) => k !== "TASK" && k !== "USER").map((k) => [k, ENTITY_TYPES[k] ?? k]));

export function TaskForm({
  action,
  task,
  assignees,
  defaults,
}: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  task?: Record<string, unknown> | null;
  assignees: Opt[];
  defaults?: { entityType?: string; entityId?: string; entityLabel?: string; assignedToId?: string };
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, null);
  const t = (task ?? {}) as Record<string, string | null | undefined>;
  const initial: Item[] = (() => {
    try {
      return task?.checklist ? (JSON.parse(String(task.checklist)) as Item[]) : [];
    } catch {
      return [];
    }
  })();
  const [items, setItems] = useState<Item[]>(initial.length ? initial : []);
  const [entityType, setEntityType] = useState(t.entityType ?? defaults?.entityType ?? "");
  const isEdit = Boolean(task?.id);
  const hasExtras = Boolean(entityType || t.tags || initial.length);

  return (
    <form onSubmit={keepFormValues(formAction)} className="space-y-4">
      {isEdit ? <input type="hidden" name="id" value={String(task!.id)} /> : null}
      <input type="hidden" name="checklist" value={JSON.stringify(items)} />
      {state?.error && <Alert tone="danger">{state.error}</Alert>}

      <Card title="المهمة">
        <FormGrid cols={3}>
          <Field label="العنوان" name="title" required className="md:col-span-3">
            <Input name="title" required defaultValue={t.title ?? ""} placeholder="مثال: متابعة تجديد عقد الوحدة 12" />
          </Field>
          <Field label="المسؤول" name="assignedToId">
            <Select name="assignedToId" options={assignees.map((a) => ({ value: a.id, label: a.name }))} placeholder="غير مسندة" defaultValue={t.assignedToId ?? defaults?.assignedToId ?? ""} />
          </Field>
          <Field label="الأولوية" name="priority">
            <Select name="priority" options={TASK_PRIORITY} defaultValue={t.priority ?? "MEDIUM"} />
          </Field>
          <Field label="تاريخ الاستحقاق" name="dueDate">
            <Input name="dueDate" type="date" defaultValue={t.dueDate ? String(t.dueDate).slice(0, 10) : ""} />
          </Field>
          <Field label="الوصف" name="description" className="md:col-span-3">
            <Textarea name="description" rows={3} defaultValue={t.description ?? ""} />
          </Field>
        </FormGrid>
      </Card>

      <Optional title="خيارات إضافية" open={hasExtras}>
        <FormGrid cols={3}>
          <Field label="نوع السجل المرتبط" name="entityType">
            <Select name="entityType" options={TASK_ENTITY_TYPES} placeholder="بدون" value={entityType} onChange={(e) => setEntityType(e.target.value)} />
          </Field>
          <Field label="معرّف السجل" name="entityId">
            <Input name="entityId" className="ltr" defaultValue={t.entityId ?? defaults?.entityId ?? ""} disabled={!entityType} />
          </Field>
          <Field label="اسم السجل" name="entityLabel">
            <Input name="entityLabel" defaultValue={t.entityLabel ?? defaults?.entityLabel ?? ""} disabled={!entityType} />
          </Field>
          <Field label="الوسوم" name="tags" help="افصل بينها بفاصلة" className="md:col-span-3">
            <Input name="tags" defaultValue={t.tags ?? ""} placeholder="تحصيل, متابعة" />
          </Field>
        </FormGrid>

        <div className="mt-5 border-t border-line pt-4">
          <span className="label mb-2 block">قائمة التحقق</span>
          <div className="space-y-2">
            {items.map((it, i) => (
              <div key={i} className="flex items-center gap-2">
                <input type="checkbox" checked={it.done} onChange={() => setItems(items.map((x, j) => (j === i ? { ...x, done: !x.done } : x)))} aria-label="منجز" />
                <Input name={`check_${i}`} value={it.text} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} placeholder="بند" />
                <button type="button" className="btn btn-ghost btn-sm !px-2" onClick={() => setItems(items.filter((_, j) => j !== i))} aria-label="حذف">
                  ×
                </button>
              </div>
            ))}
            <button type="button" className="btn btn-link btn-sm !px-0" onClick={() => items.length < 20 && setItems([...items, { text: "", done: false }])}>
              إضافة بند
            </button>
          </div>
        </div>
      </Optional>

      <FormActions>
        <Link href={isEdit ? `/tasks/${task!.id}` : "/tasks"} className="btn btn-ghost">
          إلغاء
        </Link>
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "جارٍ الحفظ…" : isEdit ? "حفظ" : "إضافة مهمة"}
        </button>
      </FormActions>
    </form>
  );
}
