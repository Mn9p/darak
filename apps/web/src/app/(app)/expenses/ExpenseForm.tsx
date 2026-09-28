"use client";


import { keepFormValues } from "@/lib/keep-form";
import { useActionState, useMemo, useState } from "react";
import Link from "next/link";
import { Field, Input, Select, Textarea, FormGrid, FormActions, Alert, Card, type FormState } from "@/components/ui";
import { Optional } from "@/components/MoreMenu";
import { EXPENSE_CATEGORIES, PAYMENT_METHODS } from "@/lib/constants";
import { money, inputDate } from "@/lib/format";

type Opt = { id: string; name: string };
export type PropertyOpt = { id: string; name: string; ownerId: string | null; units: { id: string; number: string }[] };

export function ExpenseForm({
  action,
  expense,
  properties,
  owners,
  vatRate,
  autoApproveLimit,
  defaultPropertyId,
}: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  expense?: Record<string, unknown> | null;
  properties: PropertyOpt[];
  owners: Opt[];
  vatRate: number;
  autoApproveLimit: number;
  defaultPropertyId?: string;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, null);
  const e = (expense ?? {}) as Record<string, string | number | null>;
  const isEdit = Boolean(expense?.id);

  const [propertyId, setPropertyId] = useState<string>(String(e.propertyId ?? defaultPropertyId ?? ""));
  const initialProperty = properties.find((p) => p.id === propertyId);
  const [ownerId, setOwnerId] = useState<string>(String(e.ownerId ?? initialProperty?.ownerId ?? ""));
  const [amount, setAmount] = useState<number>(Number(e.amount ?? 0));
  const initialVat = Number(e.vatAmount ?? 0);
  const [applyVat, setApplyVat] = useState<boolean>(expense ? initialVat > 0 : true);
  const [vatAmount, setVatAmount] = useState<number>(expense ? initialVat : 0);

  const property = useMemo(() => properties.find((p) => p.id === propertyId), [properties, propertyId]);
  const units = property?.units ?? [];
  const total = (Number(amount) || 0) + (applyVat ? Number(vatAmount) || 0 : 0);
  const autoVat = (v: number) => Math.round(((v * vatRate) / 100) * 100) / 100;
  const hasExtras = Boolean(e.unitId || e.payee || e.invoiceNumber || e.notes || (e.method && e.method !== "BANK_TRANSFER"));

  function onPropertyChange(id: string) {
    setPropertyId(id);
    const p = properties.find((x) => x.id === id);
    if (p?.ownerId) setOwnerId(p.ownerId);
  }

  function onAmountChange(v: number) {
    setAmount(v);
    if (applyVat) setVatAmount(autoVat(v));
  }

  function onApplyVat(checked: boolean) {
    setApplyVat(checked);
    setVatAmount(checked ? autoVat(amount) : 0);
  }

  return (
    <form onSubmit={keepFormValues(formAction)} className="space-y-4" encType="multipart/form-data">
      {isEdit ? <input type="hidden" name="id" value={String(expense!.id)} /> : null}
      {state?.error && <Alert tone="danger">{state.error}</Alert>}

      <Card title="المصروف">
        <FormGrid cols={2}>
          <Field label="العقار" name="propertyId" required>
            <Select name="propertyId" options={properties.map((p) => ({ value: p.id, label: p.name }))} placeholder="اختر العقار" value={propertyId} onChange={(ev) => onPropertyChange(ev.target.value)} required />
          </Field>
          <Field label="الفئة" name="category" required>
            <Select name="category" options={EXPENSE_CATEGORIES} defaultValue={String(e.category ?? "MAINTENANCE")} />
          </Field>
          <Field label="الوصف" name="description" required className="md:col-span-2">
            <Input name="description" defaultValue={String(e.description ?? "")} required placeholder="مثال: صيانة مصعد" />
          </Field>
          <Field label="التاريخ" name="date" required>
            <Input name="date" type="date" defaultValue={String(e.date ?? inputDate(new Date()))} required />
          </Field>
          <Field label="المبلغ قبل الضريبة" name="amount" required>
            <Input name="amount" type="number" min={0} step="0.01" value={amount || ""} onChange={(ev) => onAmountChange(Number(ev.target.value))} required className="ltr" />
          </Field>
          <Field label={`ضريبة القيمة المضافة ${vatRate}%`} name="vatAmount">
            <div className="flex items-center gap-2">
              <label className="flex shrink-0 items-center gap-1.5 text-[13px]">
                <input type="checkbox" name="applyVat" checked={applyVat} onChange={(ev) => onApplyVat(ev.target.checked)} />
                تطبيق
              </label>
              <Input name="vatAmount" type="number" min={0} step="0.01" value={applyVat ? vatAmount : 0} onChange={(ev) => setVatAmount(Number(ev.target.value))} disabled={!applyVat} className="ltr" />
            </div>
          </Field>
          <div className="flex items-end pb-1 text-[13px] text-text-2">
            الإجمالي: <b className="num mr-1 text-brand">{money(total, { decimals: true })}</b>&nbsp;ر.س
          </div>
        </FormGrid>
        {total > 0 && (
          <p className="help mt-3">{total <= autoApproveLimit ? `يُعتمد تلقائيًا عند الحفظ (حد الاعتماد التلقائي ${money(autoApproveLimit)} ر.س).` : "سيُرسل للاعتماد قبل احتسابه في تسويات الملاك."}</p>
        )}
      </Card>

      <Optional title="خيارات إضافية" open={hasExtras}>
        <FormGrid cols={2}>
          <Field label="الوحدة" name="unitId">
            <Select name="unitId" options={units.map((u) => ({ value: u.id, label: u.number }))} placeholder="على مستوى العقار" defaultValue={String(e.unitId ?? "")} disabled={!propertyId} />
          </Field>
          <Field label="تحميل المصروف" name="ownerId" help="اتركه على «كل الملاك» ليُوزَّع حسب نسب الملكية، أو اختر مالكًا ليتحمله كاملًا.">
            <Select name="ownerId" options={owners.map((o) => ({ value: o.id, label: `${o.name} (كامل المبلغ)` }))} placeholder="كل الملاك حسب نسب الملكية" value={ownerId} onChange={(ev) => setOwnerId(ev.target.value)} />
          </Field>
          <Field label="الجهة المستفيدة" name="payee">
            <Input name="payee" defaultValue={String(e.payee ?? "")} placeholder="مثال: شركة الكهرباء، مؤسسة نظافة" />
          </Field>
          <Field label="طريقة الدفع" name="method">
            <Select name="method" options={PAYMENT_METHODS} defaultValue={String(e.method ?? "BANK_TRANSFER")} />
          </Field>
          <Field label="رقم الفاتورة" name="invoiceNumber">
            <Input name="invoiceNumber" className="ltr" defaultValue={String(e.invoiceNumber ?? "")} />
          </Field>
          <Field label="ملف الفاتورة" name="invoice" help="PDF أو صورة حتى 4MB">
            <input type="file" id="invoice" name="invoice" className="input !py-1.5" accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp" />
          </Field>
          <Field label="ملاحظات" name="notes" className="md:col-span-2">
            <Textarea name="notes" defaultValue={String(e.notes ?? "")} />
          </Field>
        </FormGrid>
      </Optional>

      <FormActions>
        <Link href={isEdit ? `/expenses/${expense!.id}` : "/expenses"} className="btn btn-ghost">
          إلغاء
        </Link>
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "جارٍ الحفظ…" : isEdit ? "حفظ" : "تسجيل المصروف"}
        </button>
      </FormActions>
    </form>
  );
}
