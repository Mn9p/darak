"use client";


import { keepFormValues } from "@/lib/keep-form";
import { useActionState, useState } from "react";
import Link from "next/link";
import { Field, Input, Select, FormGrid, FormActions, Alert, Card, type FormState } from "@/components/ui";
import { Optional } from "@/components/MoreMenu";
import { DOCUMENT_TYPES, DOCUMENT_VISIBILITY, ENTITY_TYPES } from "@/lib/constants";

const LINKABLE = ["PROPERTY", "UNIT", "OWNER", "TENANT", "CONTRACT", "PAYMENT", "EXPENSE", "USER", "LEAD", "STATEMENT"];
export const DOCUMENT_ACCEPT = ".pdf,.jpg,.jpeg,.png,.webp,.xlsx,.xls,.csv,.doc,.docx";
const MAX_MB = 20;

function kb(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function DocumentForm({
  action,
  document,
  prefill,
}: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  document?: Record<string, unknown> | null;
  prefill?: { entityType?: string; entityId?: string; entityLabel?: string };
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, null);
  const d = (document ?? {}) as Record<string, string | number | null>;
  const [entityType, setEntityType] = useState<string>(String(d.entityType ?? prefill?.entityType ?? ""));
  const [fileName, setFileName] = useState<string>("");
  const [fileSize, setFileSize] = useState<number>(0);
  const [fileError, setFileError] = useState<string | null>(null);
  const isEdit = Boolean(document?.id);
  const tooBig = fileSize > MAX_MB * 1024 * 1024;
  const tags = String(d.tags ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t && !t.startsWith("ملف:") && t !== "archived")
    .join(", ");
  const hasExtras = Boolean(d.entityType || prefill?.entityType || tags || d.issueDate || (d.visibility && d.visibility !== "INTERNAL"));

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    setFileName(f?.name ?? "");
    setFileSize(f?.size ?? 0);
    setFileError(f && f.size > MAX_MB * 1024 * 1024 ? `حجم الملف يتجاوز الحد المسموح (${MAX_MB}MB).` : null);
  }

  return (
    <form onSubmit={keepFormValues(formAction)} className="space-y-4" encType="multipart/form-data">
      {isEdit ? <input type="hidden" name="id" value={String(document!.id)} /> : null}
      {state?.error && <Alert tone="danger">{state.error}</Alert>}

      <Card title="المستند">
        <FormGrid cols={3}>
          <Field label="اسم المستند" name="name" required>
            <Input name="name" defaultValue={d.name ?? ""} required placeholder="مثال: صك العقار" />
          </Field>
          <Field label="النوع" name="type" required>
            <Select name="type" options={DOCUMENT_TYPES} defaultValue={d.type ?? "OTHER"} />
          </Field>
          <Field label="تاريخ الانتهاء" name="expiryDate">
            <Input name="expiryDate" type="date" defaultValue={d.expiryDate ? String(d.expiryDate).slice(0, 10) : ""} />
          </Field>
        </FormGrid>

        <div className="mt-4">
          <div className="label mb-1.5">{isEdit ? "نسخة جديدة من الملف (اختياري)" : "الملف"}</div>
          <label className={`flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-8 text-center hover:border-brand hover:bg-mist ${tooBig ? "border-danger" : "border-line"}`}>
            <input type="file" name="file" className="hidden" accept={DOCUMENT_ACCEPT} required={!isEdit} onChange={onPick} />
            {fileName ? (
              <>
                <b className="latin text-[13.5px]">{fileName}</b>
                <span className={`num text-[12px] ${tooBig ? "text-danger" : "text-muted"}`}>{kb(fileSize)}</span>
              </>
            ) : (
              <>
                <b className="text-[13.5px]">اضغط لاختيار ملف</b>
                <span className="text-[12px] text-muted">PDF أو صورة أو Excel أو Word، حتى {MAX_MB}MB</span>
              </>
            )}
          </label>
          {fileError && <p className="help mt-2 text-danger">{fileError}</p>}
          {isEdit && <p className="help mt-2">سيُنشأ الإصدار v{Number(d.version ?? 1) + 1} ويبقى الإصدار الحالي محفوظًا.</p>}
        </div>
      </Card>

      <Optional title="خيارات إضافية" open={hasExtras}>
        <FormGrid cols={3}>
          <Field label="مستوى الظهور" name="visibility" help="يظهر للمالك أو المستأجر في بوابته عند اختياره">
            <Select name="visibility" options={DOCUMENT_VISIBILITY} defaultValue={d.visibility ?? "INTERNAL"} />
          </Field>
          <Field label="تاريخ الإصدار" name="issueDate">
            <Input name="issueDate" type="date" defaultValue={d.issueDate ? String(d.issueDate).slice(0, 10) : ""} />
          </Field>
          <Field label="الوسوم" name="tags" help="افصل بينها بفاصلة">
            <Input name="tags" defaultValue={tags} />
          </Field>
        </FormGrid>
        <div className="mt-4 border-t border-line pt-4">
          <div className="label mb-2">الربط بعقار أو وحدة أو عقد أو طرف</div>
          <FormGrid cols={3}>
            <Field label="نوع الكيان" name="entityType">
              <Select name="entityType" options={LINKABLE.map((k) => ({ value: k, label: ENTITY_TYPES[k] ?? k }))} placeholder="بدون ربط" value={entityType} onChange={(e) => setEntityType(e.target.value)} />
            </Field>
            <Field label="معرّف الكيان" name="entityId">
              <Input name="entityId" defaultValue={String(d.entityId ?? prefill?.entityId ?? "")} className="ltr" disabled={!entityType} placeholder="ID" />
            </Field>
            <Field label="اسم الكيان" name="entityLabel">
              <Input name="entityLabel" defaultValue={String(d.entityLabel ?? prefill?.entityLabel ?? "")} disabled={!entityType} placeholder="مثال: برج النخيل" />
            </Field>
          </FormGrid>
        </div>
      </Optional>

      <FormActions>
        <Link href={isEdit ? `/documents/${document!.id}` : "/documents"} className="btn btn-ghost">
          إلغاء
        </Link>
        <button type="submit" className="btn btn-primary" disabled={pending || tooBig}>
          {pending ? "جارٍ الحفظ…" : isEdit ? "حفظ" : "حفظ المستند"}
        </button>
      </FormActions>
    </form>
  );
}
