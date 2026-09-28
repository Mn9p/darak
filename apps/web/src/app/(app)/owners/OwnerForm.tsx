"use client";


import { keepFormValues } from "@/lib/keep-form";
import { localPhone } from "@/lib/phone";
import { useActionState, useState } from "react";
import Link from "next/link";
import { Field, Input, Select, Textarea, FormGrid, FormActions, Alert, Card, type FormState } from "@/components/ui";
import { Optional } from "@/components/MoreMenu";
import { PARTY_TYPES, OWNER_STATUS } from "@/lib/constants";
import { inputDate } from "@/lib/format";

type Opt = { id: string; name: string };

export function OwnerForm({
  action,
  owner,
  managers,
  canFinancial,
}: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  owner?: Record<string, unknown> | null;
  managers: Opt[];
  /** owners.financial — shows IBAN / bank fields */
  canFinancial: boolean;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, null);
  const o = (owner ?? {}) as Record<string, string | number | null>;
  const isEdit = Boolean(owner?.id);
  const [type, setType] = useState<string>(String(o.type ?? "INDIVIDUAL"));
  const isCompany = type === "COMPANY";
  const hasExtras = Boolean(
    o.vatNumber || o.representative || o.nationality || o.email || o.address || o.managementStartDate || o.accountManagerId || o.tags || o.agreementTerms || o.notes || o.iban || o.bankName || (o.status && o.status !== "ACTIVE"),
  );

  return (
    <form onSubmit={keepFormValues(formAction)} className="space-y-4" encType="multipart/form-data">
      {isEdit ? <input type="hidden" name="id" value={String(owner!.id)} /> : null}
      {state?.error && <Alert tone="danger">{state.error}</Alert>}

      <Card title="المالك">
        <FormGrid cols={3}>
          <Field label="النوع" name="type" required>
            <Select name="type" options={PARTY_TYPES} value={type} onChange={(e) => setType(e.target.value)} />
          </Field>
          <Field label={isCompany ? "اسم الشركة" : "الاسم الكامل"} name="name" required className="md:col-span-2">
            <Input name="name" defaultValue={o.name ?? ""} required placeholder={isCompany ? "مثال: شركة الديار للاستثمار" : "مثال: عبدالله بن محمد العتيبي"} />
          </Field>
          {isCompany ? (
            <Field label="رقم السجل التجاري" name="crNumber" help="يمكن إضافته لاحقًا.">
              <Input name="crNumber" className="ltr" defaultValue={o.crNumber ?? ""} />
            </Field>
          ) : (
            <Field label="رقم الهوية / الإقامة" name="nationalId">
              <Input name="nationalId" className="ltr" defaultValue={o.nationalId ?? ""} />
            </Field>
          )}
          <Field label="الجوال" name="phone" help="رقم دخول المالك إلى بوابته">
            <Input name="phone" className="ltr" type="tel" defaultValue={localPhone(o.phone == null ? null : String(o.phone))} placeholder="05xxxxxxxx" />
          </Field>
          <Field label="نسبة أتعاب الإدارة %" name="managementFeePct" required>
            <Input name="managementFeePct" type="number" step="0.01" min={0} max={100} defaultValue={o.managementFeePct ?? 5} required />
          </Field>
        </FormGrid>
      </Card>

      <Optional title="خيارات إضافية" open={hasExtras}>
        <FormGrid cols={3}>
          {isCompany ? (
            <>
              <Field label="الرقم الضريبي" name="vatNumber">
                <Input name="vatNumber" className="ltr" defaultValue={o.vatNumber ?? ""} />
              </Field>
              <Field label="الممثل / المفوض" name="representative">
                <Input name="representative" defaultValue={o.representative ?? ""} />
              </Field>
            </>
          ) : (
            <Field label="الجنسية" name="nationality">
              <Input name="nationality" defaultValue={o.nationality ?? ""} placeholder="سعودي" />
            </Field>
          )}
          <Field label="البريد الإلكتروني" name="email">
            <Input name="email" className="ltr" type="email" defaultValue={o.email ?? ""} />
          </Field>
          <Field label="العنوان" name="address">
            <Input name="address" defaultValue={o.address ?? ""} />
          </Field>
          <Field label="تاريخ بداية الإدارة" name="managementStartDate">
            <Input name="managementStartDate" type="date" defaultValue={inputDate(o.managementStartDate as string | null)} />
          </Field>
          <Field label="مدير الحساب" name="accountManagerId">
            <Select name="accountManagerId" options={managers.map((m) => ({ value: m.id, label: m.name }))} placeholder="غير محدد" defaultValue={o.accountManagerId ?? ""} />
          </Field>
          <Field label="الحالة" name="status">
            <Select name="status" options={Object.entries(OWNER_STATUS).filter(([k]) => k !== "ARCHIVED").map(([value, v]) => ({ value, label: v.label }))} defaultValue={o.status ?? "ACTIVE"} />
          </Field>
          <Field label="الوسوم" name="tags" help="افصل بينها بفاصلة">
            <Input name="tags" defaultValue={o.tags ?? ""} />
          </Field>
          {canFinancial ? (
            <>
              <Field label="رقم الآيبان (IBAN)" name="iban" help="SA + 22 رقمًا">
                <Input name="iban" className="ltr" defaultValue={o.iban ?? ""} placeholder="SA0000000000000000000000" maxLength={34} />
              </Field>
              <Field label="اسم البنك" name="bankName">
                <Input name="bankName" defaultValue={o.bankName ?? ""} />
              </Field>
            </>
          ) : null}
        </FormGrid>
        <div className="mt-4 space-y-4">
          <Field label="شروط الاتفاقية" name="agreementTerms">
            <Textarea name="agreementTerms" defaultValue={o.agreementTerms ?? ""} />
          </Field>
          <Field label="ملاحظات داخلية" name="notes">
            <Textarea name="notes" defaultValue={o.notes ?? ""} />
          </Field>
          {!isEdit && (
            <Field label={isCompany ? "صورة السجل التجاري" : "صورة الهوية / الإقامة"} name="idFile" help="PDF أو صورة، حتى 4MB">
              <input type="file" id="idFile" name="idFile" className="input !py-1.5" accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp" />
            </Field>
          )}
        </div>
      </Optional>

      <FormActions>
        <Link href={isEdit ? `/owners/${owner!.id}` : "/owners"} className="btn btn-ghost">
          إلغاء
        </Link>
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "جارٍ الحفظ…" : isEdit ? "حفظ" : "إضافة مالك"}
        </button>
      </FormActions>
    </form>
  );
}
