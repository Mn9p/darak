"use client";


import { keepFormValues } from "@/lib/keep-form";
import { useActionState, useState } from "react";
import Link from "next/link";
import { Field, Input, Select, Textarea, FormGrid, Alert, Card, type FormState } from "@/components/ui";
import { Optional } from "@/components/MoreMenu";
import { NOTIFICATION_EVENTS, NOTIFICATION_CHANNELS } from "@/lib/constants";
import { TEMPLATE_VARS, renderTemplate } from "./templating";

type Template = { id: string; name: string; event: string; channel: string; language: string; body: string; isActive: boolean };

export function TemplateForm({ action, template, onDone }: { action: (prev: FormState, fd: FormData) => Promise<FormState>; template?: Template | null; onDone?: () => void }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, null);
  const [body, setBody] = useState(template?.body ?? "");
  const preview = renderTemplate(body);
  const hasExtras = Boolean(template && (template.language !== "ar" || !template.isActive));
  return (
    <form onSubmit={keepFormValues(formAction)} className="space-y-3">
      {template?.id && <input type="hidden" name="id" value={template.id} />}
      {state?.error && <Alert tone="danger">{state.error}</Alert>}
      {state?.success && <Alert tone="success">{state.success}</Alert>}

      <Card title={template ? "تعديل القالب" : "إضافة قالب"} actions={template ? <Link href="/notifications?tab=templates" className="link text-xs">إلغاء</Link> : undefined}>
        <div className="space-y-3">
          <FormGrid cols={1}>
            <Field label="اسم القالب" name="name" required>
              <Input name="name" defaultValue={template?.name ?? ""} required placeholder="مثال: تذكير استحقاق دفعة" />
            </Field>
          </FormGrid>
          <FormGrid cols={2}>
            <Field label="الحدث" name="event" required>
              <Select name="event" options={NOTIFICATION_EVENTS} defaultValue={template?.event ?? "INSTALLMENT_DUE"} />
            </Field>
            <Field label="القناة" name="channel">
              <Select name="channel" options={NOTIFICATION_CHANNELS} defaultValue={template?.channel ?? "SMS"} />
            </Field>
          </FormGrid>
          <Field label="نص الرسالة" name="body" required>
            <Textarea name="body" value={body} onChange={(e) => setBody(e.target.value)} rows={4} required placeholder="مرحبًا {{tenant_name}}، نذكّركم باستحقاق دفعة الوحدة {{unit_number}} بقيمة {{amount}} ريال بتاريخ {{due_date}}." />
          </Field>
          <div className="flex flex-wrap gap-1.5">
            {TEMPLATE_VARS.map((v) => (
              <button key={v.key} type="button" className="tag tag-neutral tag-plain latin cursor-pointer hover:border-brand" title={v.label} onClick={() => setBody((b) => `${b}${b && !b.endsWith(" ") ? " " : ""}{{${v.key}}}`)}>
                {`{{${v.key}}}`} <span className="mr-1 font-normal">{v.label}</span>
              </button>
            ))}
          </div>
          <div className="rounded-xl bg-mist px-4 py-3">
            <div className="mb-1 text-[11.5px] font-bold text-muted">معاينة</div>
            <p className="text-[13.5px] leading-relaxed">{preview || <span className="text-faint">اكتب نص الرسالة لعرض المعاينة</span>}</p>
            <div className="num mt-1 text-[11px] text-faint">
              {preview.length} حرف{preview.length > 160 ? " · قد تُرسل كرسالتين SMS" : ""}
            </div>
          </div>
        </div>
      </Card>

      <Optional title="خيارات إضافية" open={hasExtras}>
        <FormGrid cols={2}>
          <Field label="اللغة" name="language">
            <Select name="language" options={{ ar: "العربية", en: "English" }} defaultValue={template?.language ?? "ar"} />
          </Field>
          <Field label="الحالة" name="isActive">
            <Select name="isActive" options={{ on: "نشط", off: "متوقف" }} defaultValue={template ? (template.isActive ? "on" : "off") : "on"} />
          </Field>
        </FormGrid>
      </Optional>

      <div className="flex items-center justify-end gap-2">
        {onDone && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={onDone}>
            إلغاء
          </button>
        )}
        <button type="submit" className="btn btn-primary btn-sm" disabled={pending}>
          {pending ? "جارٍ الحفظ…" : template ? "حفظ" : "إضافة القالب"}
        </button>
      </div>
    </form>
  );
}
