"use client";


import { keepFormValues } from "@/lib/keep-form";
import { useActionState } from "react";
import Link from "next/link";
import { Field, Input, Select, Textarea, FormGrid, FormActions, Alert, Card, type FormState } from "@/components/ui";
import { Optional } from "@/components/MoreMenu";
import { LEAD_SOURCES, LEAD_STAGES } from "@/lib/constants";

type Opt = { id: string; name: string };
type UnitOpt = { id: string; label: string };

export function LeadForm({
  action,
  lead,
  units,
  users,
  defaults,
}: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  lead?: Record<string, unknown> | null;
  units: UnitOpt[];
  users: Opt[];
  defaults?: { unitId?: string; assignedToId?: string };
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, null);
  const l = (lead ?? {}) as Record<string, string | number | null>;
  const viewing = l.viewingDate ? String(l.viewingDate).slice(0, 16) : "";
  const isEdit = Boolean(lead?.id);
  const hasExtras = Boolean(l.email || l.assignedToId || l.notes || (l.stage && l.stage !== "LEAD"));

  return (
    <form onSubmit={keepFormValues(formAction)} className="space-y-4">
      {isEdit ? <input type="hidden" name="id" value={String(lead!.id)} /> : null}
      {state?.error && <Alert tone="danger">{state.error}</Alert>}

      <Card title="العميل المحتمل">
        <FormGrid cols={3}>
          <Field label="الاسم" name="name" required>
            <Input name="name" defaultValue={l.name ?? ""} required placeholder="اسم العميل" />
          </Field>
          <Field label="الجوال" name="phone">
            <Input name="phone" type="tel" className="ltr" defaultValue={l.phone ?? ""} placeholder="05xxxxxxxx" />
          </Field>
          <Field label="المصدر" name="source">
            <Select name="source" options={LEAD_SOURCES} defaultValue={l.source ?? "WALK_IN"} />
          </Field>
          <Field label="الوحدة المطلوبة" name="unitId">
            <Select name="unitId" options={units.map((u) => ({ value: u.id, label: u.label }))} placeholder="بدون وحدة" defaultValue={l.unitId ?? defaults?.unitId ?? ""} />
          </Field>
          <Field label="موعد المعاينة" name="viewingDate">
            <Input name="viewingDate" type="datetime-local" defaultValue={viewing} />
          </Field>
          <Field label="قيمة العرض (ر.س / سنة)" name="offerAmount">
            <Input name="offerAmount" type="number" step="1" min={0} defaultValue={l.offerAmount ?? ""} />
          </Field>
        </FormGrid>
      </Card>

      <Optional title="خيارات إضافية" open={isEdit && hasExtras}>
        <FormGrid cols={3}>
          <Field label="البريد الإلكتروني" name="email">
            <Input name="email" type="email" defaultValue={l.email ?? ""} />
          </Field>
          <Field label="المرحلة" name="stage">
            <Select name="stage" options={LEAD_STAGES} defaultValue={l.stage ?? "LEAD"} />
          </Field>
          <Field label="الموظف المسؤول" name="assignedToId">
            <Select name="assignedToId" options={users.map((u) => ({ value: u.id, label: u.name }))} placeholder="غير محدد" defaultValue={l.assignedToId ?? defaults?.assignedToId ?? ""} />
          </Field>
        </FormGrid>
        <div className="mt-4">
          <Field label="ملاحظات" name="notes">
            <Textarea name="notes" defaultValue={l.notes ?? ""} />
          </Field>
        </div>
      </Optional>

      <FormActions>
        <Link href={isEdit ? `/leasing/${lead!.id}` : "/leasing"} className="btn btn-ghost">
          إلغاء
        </Link>
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "جارٍ الحفظ…" : isEdit ? "حفظ" : "إضافة العميل"}
        </button>
      </FormActions>
    </form>
  );
}
