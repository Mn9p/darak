"use client";


import { keepFormValues } from "@/lib/keep-form";
import { useActionState, useState } from "react";
import { Field, Input, Select, Textarea, FormGrid, Alert, type FormState } from "@/components/ui";
import { PAYMENT_FREQUENCY } from "@/lib/constants";
import { money } from "@/lib/format";

export function RenewalForm({
  action,
  contractId,
  defaultStart,
  currentAnnual,
  frequency,
  canApprove,
}: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  contractId: string;
  defaultStart: string;
  /** Current annual rent (contract total annualised). The renewal asks for the new annual rent. */
  currentAnnual: number;
  frequency: string;
  canApprove: boolean;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, null);
  const [amount, setAmount] = useState(String(currentAnnual));
  const [months, setMonths] = useState("12");
  const annual = Number(amount) || 0;
  const diff = annual - currentAnnual;
  const term = Math.max(1, Math.round(Number(months) || 12));
  const termTotal = Math.round(((annual * term) / 12) * 100) / 100;
  return (
    <form onSubmit={keepFormValues(formAction)} className="space-y-3">
      <input type="hidden" name="id" value={contractId} />
      {state?.error && <Alert tone="danger">{state.error}</Alert>}
      <FormGrid cols={2}>
        <Field label="بداية العقد الجديد" name="startDate" required>
          <Input name="startDate" type="date" defaultValue={defaultStart} required />
        </Field>
        <Field label="المدة (شهر)" name="months" required>
          <Input name="months" type="number" min={1} max={120} value={months} onChange={(e) => setMonths(e.target.value)} required />
        </Field>
        <Field
          label="الإيجار السنوي الجديد (ر.س)"
          name="annualAmount"
          help={`${diff !== 0 && currentAnnual > 0 ? `${diff > 0 ? "زيادة" : "تخفيض"} ${money(Math.abs(diff))} ر.س (${((diff / currentAnnual) * 100).toFixed(1)}%) · ` : "نفس الإيجار الحالي · "}قيمة العقد لمدة ${term} شهر: ${money(termTotal)} ر.س`}
        >
          <Input name="annualAmount" type="number" min={1} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="دورية السداد" name="paymentFrequency">
          <Select name="paymentFrequency" options={PAYMENT_FREQUENCY} defaultValue={frequency} />
        </Field>
      </FormGrid>
      <p className="text-[12.5px] text-muted">{canApprove ? "سيُنشأ عقد جديد نشط بنفس الأطراف والشروط، ويُحوّل العقد الحالي إلى «تم التجديد»." : "سيُنشأ عقد التجديد بحالة «بانتظار الاعتماد» ويُرسل لمدير المكتب."}</p>
      <button type="submit" className="btn btn-primary btn-sm" disabled={pending}>
        {pending ? "جارٍ الإنشاء…" : "إنشاء عقد التجديد"}
      </button>
    </form>
  );
}

export function TerminationForm({
  action,
  contractId,
  unpaidCount,
  unpaidAmount,
  canApprove,
  today,
}: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  contractId: string;
  unpaidCount: number;
  unpaidAmount: number;
  canApprove: boolean;
  today: string;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, null);
  const [override, setOverride] = useState(false);
  return (
    <form onSubmit={keepFormValues(formAction)} className="space-y-3">
      <input type="hidden" name="id" value={contractId} />
      {state?.error && <Alert tone="danger">{state.error}</Alert>}
      {unpaidCount > 0 && (
        <Alert tone="warning" title="قاعدة BR-002">
          يوجد <b className="num">{unpaidCount}</b> قسط مستحق غير مسدد بقيمة <b className="num">{money(unpaidAmount)}</b> ر.س. لا يمكن إنهاء العقد قبل السداد{canApprove ? " إلا بتجاوز موثّق." : "."}
        </Alert>
      )}
      <FormGrid cols={2}>
        <Field label="تاريخ الإنهاء" name="terminationDate" required>
          <Input name="terminationDate" type="date" defaultValue={today} required />
        </Field>
        <Field label="سبب الإنهاء" name="reason" required>
          <Input name="reason" required placeholder="مثال: إخلاء بطلب المستأجر" />
        </Field>
      </FormGrid>
      <Field label="التسوية النهائية" name="finalSettlement" help="مبلغ التأمين المسترد، الخصومات، أو أي اتفاق ختامي">
        <Textarea name="finalSettlement" rows={2} />
      </Field>
      {unpaidCount > 0 && canApprove && (
        <div className="space-y-2 rounded-xl border border-line p-3 text-[13px]">
          <label className="flex items-start gap-2">
            <input type="checkbox" name="override" className="mt-1" checked={override} onChange={(e) => setOverride(e.target.checked)} />
            <span>
              <b>تجاوز الأقساط غير المسددة (BR-002)</b>
              <span className="block text-[12.5px] text-muted">ستُعفى الأقساط المتبقية بسبب «إنهاء العقد» ويُسجل التجاوز باسمك.</span>
            </span>
          </label>
          {override && (
            <Field label="سبب التجاوز" name="overrideReason" required>
              <Input name="overrideReason" required placeholder="مثال: تسوية ودية مع المستأجر" />
            </Field>
          )}
        </div>
      )}
      <p className="text-[12.5px] text-muted">سيتحول العقد إلى «مفسوخ»، وتعود الوحدة «شاغرة»، وتُعفى الأقساط المستقبلية.</p>
      <button type="submit" className="btn btn-danger btn-sm" disabled={pending}>
        {pending ? "جارٍ الإنهاء…" : "إنهاء العقد"}
      </button>
    </form>
  );
}
