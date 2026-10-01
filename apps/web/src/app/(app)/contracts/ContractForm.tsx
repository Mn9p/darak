"use client";




import { displayPhone } from "@/lib/phone";
import { keepFormValues } from "@/lib/keep-form";
import { buildSchedule } from "@/lib/schedule";
import { useActionState, useMemo, useState } from "react";
import Link from "next/link";
import { Field, Input, Select, Textarea, FormGrid, FormActions, Alert, Card, Table, type FormState } from "@/components/ui";
import { Optional } from "@/components/MoreMenu";
import { PAYMENT_FREQUENCY, FREQUENCY_MONTHS, UNIT_STATUS } from "@/lib/constants";
import { addMonths, addDays, inputDate, date, money } from "@/lib/format";

export type PropertyOpt = { id: string; name: string; ownerId: string | null; ownerFeePct: number | null };
export type UnitOpt = { id: string; number: string; propertyId: string; status: string; targetRent: number | null };
export type TenantOpt = { id: string; name: string; phone: string | null };
export type OwnerOpt = { id: string; name: string; managementFeePct: number };

export type ContractPrefill = {
  propertyId?: string;
  unitId?: string;
  tenantId?: string;
  tenantName?: string;
  phone?: string;
  leadId?: string;
  totalAmount?: string;
};

type ContractLike = {
  id: string;
  propertyId: string;
  unitId: string;
  tenantId: string;
  ownerId: string;
  startDate: string;
  endDate: string;
  totalAmount: number;
  managementFeePct: number;
  vatAmount: number;
  paymentFrequency: string;
  installmentsCount: number;
  notes: string | null;
};

/** Live preview: the exact schedule the server will generate (lib/schedule). */
function previewSchedule(startDate: Date, totalAmount: number, frequency: string, months: number, customCount: number) {
  return buildSchedule({ startDate, totalAmount, frequency, installmentsCount: customCount || undefined, months });
}

function monthsBetween(a: Date, b: Date) {
  return Math.max(1, Math.round((b.getTime() - a.getTime()) / (30.4375 * 86400000)));
}

function Step({ n, title }: { n: number; title: string }) {
  return (
    <span className="flex items-center gap-2">
      <span className="num grid h-6 w-6 place-items-center rounded-full bg-brand text-[12px] font-bold text-white">{n}</span>
      {title}
    </span>
  );
}

export function ContractForm({
  action,
  contract,
  properties,
  units,
  tenants,
  owners,
  prefill,
  canApprove,
  canCreateTenant,
}: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  contract?: ContractLike | null;
  properties: PropertyOpt[];
  units: UnitOpt[];
  tenants: TenantOpt[];
  owners: OwnerOpt[];
  prefill?: ContractPrefill;
  canApprove: boolean;
  canCreateTenant: boolean;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, null);
  const isEdit = Boolean(contract?.id);

  const initialUnit = units.find((u) => u.id === (contract?.unitId ?? prefill?.unitId));
  const initialPropertyId = contract?.propertyId ?? prefill?.propertyId ?? initialUnit?.propertyId ?? "";
  const initialProperty = properties.find((p) => p.id === initialPropertyId);
  const initialOwnerId = contract?.ownerId ?? initialProperty?.ownerId ?? "";
  const initialOwner = owners.find((o) => o.id === initialOwnerId);

  const [propertyId, setPropertyId] = useState(initialPropertyId);
  const [unitId, setUnitId] = useState(contract?.unitId ?? prefill?.unitId ?? "");
  const [ownerId, setOwnerId] = useState(initialOwnerId);
  const [feePct, setFeePct] = useState<string>(String(contract?.managementFeePct ?? initialOwner?.managementFeePct ?? initialProperty?.ownerFeePct ?? 5));
  // A new office has no tenants yet: start on "new tenant" instead of an empty list.
  const [tenantMode, setTenantMode] = useState<"existing" | "new">(contract?.tenantId || prefill?.tenantId ? "existing" : (prefill?.tenantName || tenants.length === 0) && canCreateTenant ? "new" : "existing");
  const [startDate, setStartDate] = useState(contract ? inputDate(contract.startDate) : inputDate(new Date()));
  const [months, setMonths] = useState<number>(contract ? monthsBetween(new Date(contract.startDate), addDays(new Date(contract.endDate), 1)) : 12);
  const [totalAmount, setTotalAmount] = useState<string>(String(contract?.totalAmount ?? prefill?.totalAmount ?? initialUnit?.targetRent ?? ""));
  const [frequency, setFrequency] = useState(contract?.paymentFrequency ?? "QUARTERLY");
  const [customCount, setCustomCount] = useState<number>(contract?.installmentsCount ?? 4);
  const [override, setOverride] = useState(false);
  const [vat, setVat] = useState<string>(String(contract?.vatAmount ?? 0));

  const start = useMemo(() => {
    const d = new Date(startDate);
    return Number.isNaN(d.getTime()) ? new Date() : d;
  }, [startDate]);
  const endDate = useMemo(() => addDays(addMonths(start, Math.max(1, months || 1)), -1), [start, months]);
  const amountNum = Number(totalAmount) || 0;
  const vatNum = Math.max(0, Number(vat) || 0);
  // VAT is billed with the rent, spread over the installments (same as activation).
  const schedule = useMemo(() => previewSchedule(start, Math.round((amountNum + vatNum) * 100) / 100, frequency, Math.max(1, months || 1), customCount), [start, amountNum, vatNum, frequency, months, customCount]);

  const propertyUnits = units.filter((u) => u.propertyId === propertyId && (override || u.status !== "RENTED" || u.id === contract?.unitId));
  const selectedUnit = units.find((u) => u.id === unitId);
  const hasExtras = Boolean(contract?.vatAmount || contract?.notes);

  function onPropertyChange(id: string) {
    setPropertyId(id);
    setUnitId("");
    const p = properties.find((x) => x.id === id);
    if (p?.ownerId) {
      setOwnerId(p.ownerId);
      const o = owners.find((x) => x.id === p.ownerId);
      setFeePct(String(o?.managementFeePct ?? p.ownerFeePct ?? 5));
    }
  }
  function onUnitChange(id: string) {
    setUnitId(id);
    const u = units.find((x) => x.id === id);
    if (u?.targetRent && !totalAmount) setTotalAmount(String(u.targetRent));
  }
  function onOwnerChange(id: string) {
    setOwnerId(id);
    const o = owners.find((x) => x.id === id);
    if (o) setFeePct(String(o.managementFeePct));
  }

  const feeAmount = (amountNum * (Number(feePct) || 0)) / 100;

  return (
    <form onSubmit={keepFormValues(formAction)} className="space-y-4">
      {contract?.id ? <input type="hidden" name="id" value={contract.id} /> : null}
      {prefill?.leadId ? <input type="hidden" name="leadId" value={prefill.leadId} /> : null}
      <input type="hidden" name="endDate" value={inputDate(endDate)} />
      {state?.error && <Alert tone="danger">{state.error}</Alert>}

      {/* 1 — الأطراف */}
      <Card title={<Step n={1} title="الأطراف" />}>
        <FormGrid cols={3}>
          <Field label="العقار" name="propertyId" required>
            <Select name="propertyId" options={properties.map((p) => ({ value: p.id, label: p.name }))} placeholder="اختر العقار" value={propertyId} onChange={(e) => onPropertyChange(e.target.value)} required />
          </Field>
          <Field label="الوحدة" name="unitId" required>
            <Select
              name="unitId"
              options={propertyUnits.map((u) => ({ value: u.id, label: `${u.number} · ${UNIT_STATUS[u.status]?.label ?? u.status}${u.targetRent ? ` · ${money(u.targetRent)} ر.س` : ""}` }))}
              placeholder={propertyId ? "اختر الوحدة" : "اختر العقار أولًا"}
              value={unitId}
              onChange={(e) => onUnitChange(e.target.value)}
              required
              disabled={!propertyId}
            />
            {propertyId && propertyUnits.length === 0 && (
              <div className="help">
                لا توجد وحدات غير مؤجرة في هذا العقار.{" "}
                <Link href={`/units/new?propertyId=${propertyId}`} className="link">
                  إضافة وحدة
                </Link>
              </div>
            )}
          </Field>
          <Field label="المالك" name="ownerId" required>
            <Select name="ownerId" options={owners.map((o) => ({ value: o.id, label: o.name }))} placeholder="اختر المالك" value={ownerId} onChange={(e) => onOwnerChange(e.target.value)} required />
          </Field>
        </FormGrid>

        <div className="mt-5 border-t border-line pt-4">
          <div className="mb-3 flex flex-wrap items-center gap-4 text-[13px]">
            <span className="label">المستأجر</span>
            <label className="flex items-center gap-1.5">
              <input type="radio" name="tenantMode" value="existing" checked={tenantMode === "existing"} onChange={() => setTenantMode("existing")} /> مستأجر مسجل
            </label>
            {canCreateTenant && (
              <label className="flex items-center gap-1.5">
                <input type="radio" name="tenantMode" value="new" checked={tenantMode === "new"} onChange={() => setTenantMode("new")} /> مستأجر جديد
              </label>
            )}
          </div>
          {tenantMode === "existing" ? (
            <Field label="المستأجر" name="tenantId" required>
              <Select name="tenantId" options={tenants.map((t) => ({ value: t.id, label: `${t.name}${t.phone ? ` · ${displayPhone(t.phone)}` : ""}` }))} placeholder="اختر المستأجر" defaultValue={contract?.tenantId ?? prefill?.tenantId ?? ""} required />
            </Field>
          ) : (
            <FormGrid cols={3}>
              <Field label="اسم المستأجر" name="newTenantName" required>
                <Input name="newTenantName" defaultValue={prefill?.tenantName ?? ""} required placeholder="الاسم الكامل" />
              </Field>
              <Field label="الجوال" name="newTenantPhone">
                <Input name="newTenantPhone" type="tel" className="ltr" defaultValue={prefill?.phone ?? ""} />
              </Field>
              <Field label="رقم الهوية / السجل" name="newTenantNationalId">
                <Input name="newTenantNationalId" className="ltr" />
              </Field>
            </FormGrid>
          )}
        </div>
      </Card>

      {/* 2 — المدة والقيمة */}
      <Card title={<Step n={2} title="المدة والقيمة" />}>
        <FormGrid cols={3}>
          <Field label="تاريخ البداية" name="startDate" required>
            <Input name="startDate" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
          </Field>
          <Field label="المدة (شهر)" name="months" required>
            <Input name="months" type="number" min={1} max={120} value={months} onChange={(e) => setMonths(Number(e.target.value))} required />
          </Field>
          <Field label="تاريخ النهاية">
            <Input value={inputDate(endDate)} type="date" readOnly className="bg-mist" />
          </Field>
          <Field label="قيمة العقد (ر.س)" name="totalAmount" required help={selectedUnit?.targetRent ? `الإيجار المستهدف للوحدة: ${money(selectedUnit.targetRent)} ر.س` : undefined}>
            <Input name="totalAmount" type="number" min={1} step="1" value={totalAmount} onChange={(e) => setTotalAmount(e.target.value)} required />
          </Field>
          <Field label="أتعاب الإدارة %" name="managementFeePct" help={`≈ ${money(feeAmount)} ر.س من قيمة العقد`}>
            <Input name="managementFeePct" type="number" min={0} max={100} step="0.01" value={feePct} onChange={(e) => setFeePct(e.target.value)} />
          </Field>
        </FormGrid>
      </Card>

      {/* 3 — الدفعات */}
      <Card title={<Step n={3} title="الدفعات" />}>
        <FormGrid cols={3}>
          <Field label="دورية السداد" name="paymentFrequency" required>
            <Select name="paymentFrequency" options={PAYMENT_FREQUENCY} value={frequency} onChange={(e) => setFrequency(e.target.value)} />
          </Field>
          {frequency === "CUSTOM" && (
            <Field label="عدد الأقساط" name="installmentsCount" required>
              <Input name="installmentsCount" type="number" min={1} max={60} value={customCount} onChange={(e) => setCustomCount(Number(e.target.value))} />
            </Field>
          )}
        </FormGrid>

        {amountNum > 0 ? (
          <details className="group mt-4 rounded-xl border border-line" open>
            <summary className="flex cursor-pointer items-center justify-between px-4 py-3 text-[13px] font-bold text-brand">
              <span>
                جدول الأقساط المتوقع <span className="num font-normal text-muted">({schedule.length} قسط · {PAYMENT_FREQUENCY[frequency]})</span>
              </span>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="transition group-open:rotate-180" aria-hidden>
                <path d="m6 9 6 6 6-6" />
              </svg>
            </summary>
            <div className="border-t border-line">
              <Table>
                <thead>
                  <tr>
                    <th className="num">#</th>
                    <th>تاريخ الاستحقاق</th>
                    <th className="num">المبلغ</th>
                  </tr>
                </thead>
                <tbody>
                  {schedule.map((r) => (
                    <tr key={r.seq}>
                      <td className="num">{r.seq}</td>
                      <td>{date(r.dueDate)}</td>
                      <td className="num font-semibold">{money(r.amount, { decimals: true })}</td>
                    </tr>
                  ))}
                  <tr>
                    <td></td>
                    <td className="font-bold">الإجمالي</td>
                    <td className="num font-bold text-brand">{money(schedule.reduce((s, r) => s + r.amount, 0), { decimals: true })}</td>
                  </tr>
                </tbody>
              </Table>
            </div>
            <p className="px-4 py-2 text-[12px] text-muted">يُنشأ الجدول فعليًا عند تفعيل العقد.</p>
          </details>
        ) : (
          <p className="mt-4 text-[13px] text-muted">أدخل قيمة العقد لعرض جدول الأقساط.</p>
        )}

        {!isEdit && (
          <label className="mt-4 flex items-start gap-2 border-t border-line pt-4 text-[13.5px]">
            <input type="checkbox" name="activate" className="mt-1" defaultChecked={canApprove} />
            <span>
              <b>تفعيل مباشرة</b>
              <span className="block text-[12.5px] text-muted">{canApprove ? "يُنشأ العقد نشطًا مع جدول الأقساط وتصبح الوحدة مؤجرة." : "يُرسل العقد لصاحب الحساب بانتظار الاعتماد."}</span>
            </span>
          </label>
        )}
      </Card>

      <Optional title="خيارات إضافية" open={isEdit && hasExtras}>
        <FormGrid cols={3}>
          <Field label="ضريبة القيمة المضافة (ر.س)" name="vatAmount">
            <div className="flex gap-1">
              <Input name="vatAmount" type="number" min={0} step="0.01" value={vat} onChange={(e) => setVat(e.target.value)} />
              <button type="button" className="btn btn-ghost btn-sm shrink-0" onClick={() => setVat(String(Math.round(amountNum * 15) / 100))}>
                15%
              </button>
            </div>
          </Field>
        </FormGrid>
        <div className="mt-4">
          <Field label="ملاحظات وشروط خاصة" name="notes">
            <Textarea name="notes" defaultValue={contract?.notes ?? ""} />
          </Field>
        </div>
        {canApprove && (
          <label className="mt-4 flex items-start gap-2 text-[13.5px]">
            <input type="checkbox" name="override" className="mt-1" checked={override} onChange={(e) => setOverride(e.target.checked)} />
            <span>
              <b>السماح بالتعاقد على وحدة مرتبطة بعقد نشط</b>
              <span className="block text-[12.5px] text-muted">يُسجل التجاوز في سجل العمليات.</span>
            </span>
          </label>
        )}
      </Optional>

      <FormActions>
        <Link href={contract?.id ? `/contracts/${contract.id}` : "/contracts"} className="btn btn-ghost">
          إلغاء
        </Link>
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "جارٍ الحفظ…" : isEdit ? "حفظ" : "حفظ العقد"}
        </button>
      </FormActions>
    </form>
  );
}
