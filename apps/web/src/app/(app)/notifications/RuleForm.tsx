"use client";


import { keepFormValues } from "@/lib/keep-form";
import { useActionState } from "react";
import Link from "next/link";
import { Field, Input, Select, FormGrid, Alert, Card, type FormState } from "@/components/ui";
import { Optional } from "@/components/MoreMenu";
import { NOTIFICATION_EVENTS, NOTIFICATION_CHANNELS, ROLES } from "@/lib/constants";

type Rule = { id: string; name: string; event: string; daysBefore: number; channels: string; targetRoles: string; createTask: boolean; isActive: boolean };

export function RuleForm({ action, rule, onDone }: { action: (prev: FormState, fd: FormData) => Promise<FormState>; rule?: Rule | null; onDone?: () => void }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, null);
  const channels = (rule?.channels ?? "IN_APP").split(",");
  const roles = (rule?.targetRoles ?? "OFFICE_MANAGER").split(",");
  const hasExtras = Boolean(rule && (rule.createTask || !rule.isActive || rule.channels !== "IN_APP" || rule.targetRoles !== "OFFICE_MANAGER"));
  return (
    <form onSubmit={keepFormValues(formAction)} className="space-y-3">
      {rule?.id && <input type="hidden" name="id" value={rule.id} />}
      {state?.error && <Alert tone="danger">{state.error}</Alert>}
      {state?.success && <Alert tone="success">{state.success}</Alert>}

      <Card title={rule ? "تعديل القاعدة" : "إضافة قاعدة"} actions={rule ? <Link href="/notifications?tab=rules" className="link text-xs">إلغاء</Link> : undefined}>
        <FormGrid cols={1}>
          <Field label="اسم القاعدة" name="name" required>
            <Input name="name" defaultValue={rule?.name ?? ""} required placeholder="مثال: تنبيه انتهاء عقد قبل 60 يومًا" />
          </Field>
          <Field label="الحدث" name="event" required>
            <Select name="event" options={NOTIFICATION_EVENTS} defaultValue={rule?.event ?? "CONTRACT_EXPIRING"} />
          </Field>
          <Field label="قبل الحدث بـ (يوم)" name="daysBefore" help="0 عند وقوع الحدث مباشرة">
            <Input name="daysBefore" type="number" min={0} max={365} defaultValue={rule?.daysBefore ?? 0} />
          </Field>
        </FormGrid>
      </Card>

      <Optional title="خيارات إضافية" open={hasExtras}>
        <div className="space-y-4">
          <div>
            <div className="label">القنوات</div>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-[13px]">
              {Object.entries(NOTIFICATION_CHANNELS).map(([k, v]) => (
                <label key={k} className="flex items-center gap-1.5">
                  <input type="checkbox" name="channels" value={k} defaultChecked={channels.includes(k)} /> {v}
                </label>
              ))}
            </div>
          </div>
          <div>
            <div className="label">الأدوار المستهدفة</div>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-[13px]">
              {Object.entries(ROLES)
                .filter(([k]) => k !== "SUPER_ADMIN")
                .map(([k, v]) => (
                  <label key={k} className="flex items-center gap-1.5">
                    <input type="checkbox" name="targetRoles" value={k} defaultChecked={roles.includes(k)} /> {v.label}
                  </label>
                ))}
            </div>
          </div>
          <label className="flex items-center gap-2 text-[13px]">
            <input type="checkbox" name="createTask" defaultChecked={rule?.createTask ?? false} /> إنشاء مهمة للموظف المسؤول عند تفعيل القاعدة
          </label>
          <Field label="الحالة" name="isActive">
            <Select name="isActive" options={{ on: "نشطة", off: "متوقفة" }} defaultValue={rule ? (rule.isActive ? "on" : "off") : "on"} className="!w-40" />
          </Field>
        </div>
      </Optional>

      <div className="flex items-center justify-end gap-2">
        {onDone && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={onDone}>
            إلغاء
          </button>
        )}
        <button type="submit" className="btn btn-primary btn-sm" disabled={pending}>
          {pending ? "جارٍ الحفظ…" : rule ? "حفظ" : "إضافة القاعدة"}
        </button>
      </div>
    </form>
  );
}
