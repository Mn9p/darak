"use client";


import { keepFormValues } from "@/lib/keep-form";
import { localPhone } from "@/lib/phone";
import { useActionState, useState } from "react";
import Link from "next/link";
import { Field, Input, Select, Textarea, FormGrid, FormActions, Alert, Card, type FormState } from "@/components/ui";
import { Optional } from "@/components/MoreMenu";
import { PARTY_TYPES, OWNER_STATUS, RISK_LEVELS } from "@/lib/constants";
import { inputDate } from "@/lib/format";

export function TenantForm({ action, tenant }: { action: (prev: FormState, fd: FormData) => Promise<FormState>; tenant?: Record<string, unknown> | null }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, null);
  const t = (tenant ?? {}) as Record<string, string | number | null>;
  const isEdit = Boolean(tenant?.id);
  const [type, setType] = useState<string>(String(t.type ?? "INDIVIDUAL"));
  const isCompany = type === "COMPANY";
  const hasExtras = Boolean(t.vatNumber || t.representative || t.idExpiry || t.employer || t.address || t.altContactName || t.altContactPhone || t.tags || t.notes || (t.status && t.status !== "ACTIVE"));

  return (
    <form onSubmit={keepFormValues(formAction)} className="space-y-4" encType="multipart/form-data">
      {isEdit ? <input type="hidden" name="id" value={String(tenant!.id)} /> : null}
      {state?.error && <Alert tone="danger">{state.error}</Alert>}

      <Card title="المستأجر">
        <FormGrid cols={3}>
          <Field label="النوع" name="type" required>
            <Select name="type" options={PARTY_TYPES} value={type} onChange={(e) => setType(e.target.value)} />
          </Field>
          <Field label={isCompany ? "اسم الشركة" : "الاسم الكامل"} name="name" required className="md:col-span-2">
            <Input name="name" defaultValue={t.name ?? ""} required placeholder={isCompany ? "مثال: شركة الأفق للتقنية" : "مثال: محمد بن سعد القحطاني"} />
          </Field>
          {isCompany ? (
            <Field label="رقم السجل التجاري" name="crNumber" help="يمكن إضافته لاحقًا.">
              <Input name="crNumber" className="ltr" defaultValue={t.crNumber ?? ""} />
            </Field>
          ) : (
            <Field label="رقم الهوية / الإقامة" name="nationalId" help="يمكن إضافته لاحقًا.">
              <Input name="nationalId" className="ltr" defaultValue={t.nationalId ?? ""} />
            </Field>
          )}
          <Field label="الجوال" name="phone" required help="رقم دخول المستأجر إلى بوابته">
            <Input name="phone" className="ltr" type="tel" defaultValue={localPhone(t.phone == null ? null : String(t.phone))} required placeholder="05xxxxxxxx" />
          </Field>
          <Field label="البريد الإلكتروني" name="email">
            <Input name="email" className="ltr" type="email" defaultValue={t.email ?? ""} />
          </Field>
          <Field label="مستوى المخاطر" name="riskLevel">
            <Select name="riskLevel" options={RISK_LEVELS} defaultValue={t.riskLevel ?? "LOW"} />
          </Field>
        </FormGrid>
      </Card>

      <Optional title="خيارات إضافية" open={hasExtras}>
        <FormGrid cols={3}>
          {isCompany ? (
            <>
              <Field label="الرقم الضريبي" name="vatNumber">
                <Input name="vatNumber" className="ltr" defaultValue={t.vatNumber ?? ""} />
              </Field>
              <Field label="الممثل / المفوض بالتوقيع" name="representative">
                <Input name="representative" defaultValue={t.representative ?? ""} />
              </Field>
            </>
          ) : (
            <>
              <Field label="تاريخ انتهاء الهوية" name="idExpiry">
                <Input name="idExpiry" type="date" defaultValue={inputDate(t.idExpiry as string | null)} />
              </Field>
              <Field label="جهة العمل" name="employer">
                <Input name="employer" defaultValue={t.employer ?? ""} />
              </Field>
            </>
          )}
          <Field label="العنوان" name="address">
            <Input name="address" defaultValue={t.address ?? ""} />
          </Field>
          <Field label="جهة اتصال بديلة" name="altContactName">
            <Input name="altContactName" defaultValue={t.altContactName ?? ""} />
          </Field>
          <Field label="جوال جهة الاتصال البديلة" name="altContactPhone">
            <Input name="altContactPhone" className="ltr" type="tel" defaultValue={t.altContactPhone ?? ""} />
          </Field>
          <Field label="الحالة" name="status">
            <Select name="status" options={Object.entries(OWNER_STATUS).filter(([k]) => k !== "ARCHIVED").map(([value, v]) => ({ value, label: v.label }))} defaultValue={t.status ?? "ACTIVE"} />
          </Field>
          <Field label="الوسوم" name="tags" help="افصل بينها بفاصلة">
            <Input name="tags" defaultValue={t.tags ?? ""} />
          </Field>
        </FormGrid>
        <div className="mt-4 space-y-4">
          <Field label="ملاحظات داخلية" name="notes">
            <Textarea name="notes" defaultValue={t.notes ?? ""} />
          </Field>
          {!isEdit && (
            <Field label={isCompany ? "صورة السجل التجاري" : "صورة الهوية / الإقامة"} name="idFile" help="PDF أو صورة، حتى 4MB">
              <input type="file" id="idFile" name="idFile" className="input !py-1.5" accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp" />
            </Field>
          )}
        </div>
      </Optional>

      <FormActions>
        <Link href={isEdit ? `/tenants/${tenant!.id}` : "/tenants"} className="btn btn-ghost">
          إلغاء
        </Link>
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "جارٍ الحفظ…" : isEdit ? "حفظ" : "إضافة مستأجر"}
        </button>
      </FormActions>
    </form>
  );
}
