"use client";


import { keepFormValues } from "@/lib/keep-form";
import { useActionState } from "react";
import Link from "next/link";
import { Field, Input, Select, FormGrid, FormActions, Alert, Card, type FormState } from "@/components/ui";
import { PLANS, ORG_STATUS, CITIES } from "@/lib/constants";

/** Values prefilled from an access request (/admin/requests → "إنشاء المكتب"). */
export interface OrgPrefill {
  requestId: string;
  /** Human date of the request, shown in the notice. */
  requestedAt: string;
  name?: string;
  city?: string;
  phone?: string;
  managerName?: string;
  managerPhone?: string;
}

export function OrgForm({ action, prefill }: { action: (prev: FormState, fd: FormData) => Promise<FormState>; prefill?: OrgPrefill }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, null);
  const planOptions = Object.entries(PLANS).map(([value, p]) => ({ value, label: `${p.label} — ${p.units.toLocaleString("en-US")} وحدة / ${p.users} مستخدم` }));
  const cityOptions = CITIES.map((c) => ({ value: c, label: c }));
  // A city typed on the public form may not be in our list — keep it selectable rather than dropping it.
  if (prefill?.city && !CITIES.includes(prefill.city)) cityOptions.unshift({ value: prefill.city, label: prefill.city });

  return (
    <form onSubmit={keepFormValues(formAction)} className="space-y-4">
      {state?.error && <Alert tone="danger">{state.error}</Alert>}
      {prefill && (
        <Alert tone="info">
          من طلب حساب بتاريخ <span className="num">{prefill.requestedAt}</span> — راجع البيانات المعبّأة وأكمل الناقص. سيُعلَّم الطلب «تم إنشاء المكتب» عند الحفظ.
        </Alert>
      )}
      {prefill && <input type="hidden" name="requestId" value={prefill.requestId} />}
      <Card title="بيانات المكتب">
        <FormGrid cols={3}>
          <Field label="اسم المكتب" name="name" required>
            <Input name="name" required placeholder="مثال: مكتب الديار للعقارات" defaultValue={prefill?.name ?? ""} />
          </Field>
          <Field label="المعرّف (slug)" name="slug" help="اختياري — يُولّد تلقائيًا من الاسم">
            <Input name="slug" placeholder="aldiyar" className="latin" />
          </Field>
          <Field label="المدينة" name="city">
            <Select name="city" options={cityOptions} placeholder="— اختر —" defaultValue={prefill?.city ?? ""} />
          </Field>
          <Field label="الهاتف" name="phone">
            <Input name="phone" placeholder="+966 11 000 0000" className="latin" defaultValue={prefill?.phone ?? ""} />
          </Field>
          <Field label="البريد الإلكتروني" name="email">
            <Input name="email" type="email" placeholder="info@office.sa" className="latin" />
          </Field>
          <Field label="السجل التجاري" name="crNumber">
            <Input name="crNumber" className="latin" />
          </Field>
          <Field label="الرقم الضريبي" name="vatNumber">
            <Input name="vatNumber" className="latin" />
          </Field>
        </FormGrid>
      </Card>

      <Card title="الاشتراك" subtitle="تُضبط حدود الوحدات والمستخدمين تلقائيًا من الخطة ويمكن تعديلها لاحقًا">
        <FormGrid cols={3}>
          <Field label="الخطة" name="plan" required>
            <Select name="plan" options={planOptions} defaultValue="PROFESSIONAL" />
          </Field>
          <Field label="الحالة" name="status" required>
            <Select name="status" options={ORG_STATUS} defaultValue="TRIAL" />
          </Field>
          <Field label="تاريخ التجديد" name="renewalDate" help="افتراضيًا بعد 12 شهرًا">
            <Input name="renewalDate" type="date" />
          </Field>
        </FormGrid>
      </Card>

      <Card title="مدير المكتب الأول" subtitle="يُنشأ حساب بدور OFFICE_MANAGER يدخل برقم جواله ويمكنه دعوة بقية الفريق">
        <FormGrid cols={2}>
          <Field label="الاسم" name="managerName" required>
            <Input name="managerName" required defaultValue={prefill?.managerName ?? ""} />
          </Field>
          <Field label="الجوال" name="managerPhone" required help="رقم الدخول — يصله رمز التحقق عند كل دخول">
            <Input name="managerPhone" type="tel" inputMode="tel" required placeholder="05XXXXXXXX" className="latin" defaultValue={prefill?.managerPhone ?? ""} />
          </Field>
          <Field label="البريد الإلكتروني" name="managerEmail" help="اختياري">
            <Input name="managerEmail" type="email" className="latin" />
          </Field>
        </FormGrid>
      </Card>

      <FormActions>
        <Link href="/admin/organizations" className="btn btn-ghost">إلغاء</Link>
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "جارٍ الإنشاء…" : "إنشاء المكتب"}
        </button>
      </FormActions>
    </form>
  );
}
