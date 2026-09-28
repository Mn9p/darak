"use client";


import { keepFormValues } from "@/lib/keep-form";
import { useActionState, useMemo, useState } from "react";
import Link from "next/link";
import { Field, Input, Select, Textarea, FormGrid, FormActions, Alert, Card, Table, StatusTag, type FormState } from "@/components/ui";
import { Optional } from "@/components/MoreMenu";
import { PAYMENT_METHODS, INSTALLMENT_STATUS } from "@/lib/constants";
import { displayPhone, normalizePhone } from "@/lib/phone";

export type TenantOpt = { id: string; code: string; name: string; phone: string | null };
export type OpenInstallment = {
  id: string;
  tenantId: string;
  contractId: string;
  contractCode: string;
  unitNumber: string;
  seq: number;
  dueDate: string; // yyyy-mm-dd
  dueLabel: string;
  amount: number;
  paidAmount: number;
  status: string;
};

const nf = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Oldest-first allocation of `total` across open installments. */
function allocateOldestFirst(open: OpenInstallment[], total: number): Record<string, number> {
  const next: Record<string, number> = {};
  let left = total;
  for (const i of open) {
    if (left <= 0) break;
    const remaining = r2(i.amount - i.paidAmount);
    const take = Math.min(remaining, left);
    if (take > 0) next[i.id] = r2(take);
    left = r2(left - take);
  }
  return next;
}

export function PaymentForm({
  action,
  tenants,
  installments,
  prefill,
}: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  tenants: TenantOpt[];
  installments: OpenInstallment[];
  prefill: { tenantId?: string; installmentId?: string; amount?: number; reference?: string; date: string };
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, null);
  const labelOf = (t: TenantOpt) => `${t.name} — ${t.code}`;
  const initialTenant = tenants.find((t) => t.id === prefill.tenantId);
  const [tenantInput, setTenantInput] = useState(initialTenant ? labelOf(initialTenant) : "");
  const [tenantId, setTenantId] = useState(initialTenant?.id ?? "");
  const [amount, setAmount] = useState<number>(prefill.amount ?? 0);
  // A specific installment was requested (e.g. from a collection case): start in manual mode on that installment.
  const [auto, setAuto] = useState(!prefill.installmentId);
  const [manual, setManual] = useState<Record<string, number>>(() => {
    if (prefill.installmentId && prefill.tenantId) {
      const inst = installments.find((i) => i.id === prefill.installmentId);
      if (inst) {
        const remaining = r2(inst.amount - inst.paidAmount);
        return { [inst.id]: prefill.amount ? Math.min(prefill.amount, remaining) : remaining };
      }
    }
    return {};
  });
  const [amountTouched, setAmountTouched] = useState(Boolean(prefill.amount));

  const open = useMemo(() => installments.filter((i) => i.tenantId === tenantId).sort((a, b) => a.dueDate.localeCompare(b.dueDate)), [installments, tenantId]);
  const alloc = useMemo(() => (auto ? allocateOldestFirst(open, amountTouched ? amount : 0) : manual), [auto, open, amount, amountTouched, manual]);
  const allocated = r2(open.reduce((s, i) => s + (alloc[i.id] || 0), 0));
  // In manual mode the amount defaults to the allocated total until the user types one.
  const effectiveAmount = amountTouched || auto ? amount : allocated;
  const leftover = r2(effectiveAmount - allocated);
  const over = leftover < -0.009;

  function pickTenant(v: string) {
    setTenantInput(v);
    const t = tenants.find((x) => labelOf(x) === v || x.code === v || (x.phone && normalizePhone(x.phone) === normalizePhone(v)));
    const id = t?.id ?? "";
    if (id !== tenantId) {
      setTenantId(id);
      setManual({});
    }
  }

  return (
    <form onSubmit={keepFormValues(formAction)} className="space-y-4" encType="multipart/form-data">
      <input type="hidden" name="tenantId" value={tenantId} />
      {state?.error && <Alert tone="danger">{state.error}</Alert>}

      <Card title="سند القبض">
        <FormGrid cols={2}>
          <Field label="المستأجر" name="tenantSearch" required>
            <Input name="tenantSearch" list="tenants-list" value={tenantInput} onChange={(e) => pickTenant(e.target.value)} placeholder="الاسم أو الرقم أو الجوال" autoComplete="off" required />
            <datalist id="tenants-list">
              {tenants.map((t) => (
                <option key={t.id} value={labelOf(t)}>
                  {t.phone ? displayPhone(t.phone) : ""}
                </option>
              ))}
            </datalist>
            {tenantInput && !tenantId && <div className="help text-danger">اختر مستأجرًا من القائمة.</div>}
          </Field>
          <Field label="المبلغ (ر.س)" name="amount" required>
            <Input
              name="amount"
              type="number"
              min={0.01}
              step="0.01"
              value={effectiveAmount || ""}
              onChange={(e) => {
                setAmountTouched(true);
                setAmount(Number(e.target.value) || 0);
              }}
              required
            />
          </Field>
          <Field label="تاريخ الدفع" name="paidAt" required>
            <Input name="paidAt" type="date" defaultValue={prefill.date} required />
          </Field>
          <Field label="طريقة الدفع" name="method" required>
            <Select name="method" options={PAYMENT_METHODS} defaultValue="BANK_TRANSFER" />
          </Field>
        </FormGrid>
      </Card>

      <Card
        title="التخصيص على الأقساط"
        subtitle={tenantId ? `${open.length} قسط مفتوح` : "اختر المستأجر لعرض أقساطه المفتوحة."}
        actions={
          tenantId && open.length > 0 ? (
            <>
              <label className="flex items-center gap-1.5 text-[12.5px] font-semibold text-text-2">
                <input type="checkbox" checked={auto} onChange={(e) => {
                  setAuto(e.target.checked);
                  if (!e.target.checked) setManual(alloc);
                }} />
                تخصيص تلقائي
              </label>
              {!auto && (
                <button type="button" className="btn btn-ghost btn-xs" onClick={() => setManual({})}>
                  مسح
                </button>
              )}
            </>
          ) : undefined
        }
        padded={false}
      >
        {!tenantId ? (
          <p className="px-5 pb-5 text-[13px] text-muted">لم يتم اختيار مستأجر بعد.</p>
        ) : open.length === 0 ? (
          <p className="px-5 pb-5 text-[13px] text-muted">لا توجد أقساط مفتوحة لهذا المستأجر. سيُحفظ السند كرصيد دائن للمستأجر.</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>العقد / الوحدة</th>
                <th className="num">القسط</th>
                <th>الاستحقاق</th>
                <th>الحالة</th>
                <th className="num">المتبقي</th>
                <th className="num w-40">التخصيص</th>
              </tr>
            </thead>
            <tbody>
              {open.map((i) => {
                const remaining = r2(i.amount - i.paidAmount);
                const v = alloc[i.id] || 0;
                return (
                  <tr key={i.id}>
                    <td>
                      <span className="latin">{i.contractCode}</span>
                      <div className="cell-sub latin">{i.unitNumber}</div>
                    </td>
                    <td className="num">{i.seq}</td>
                    <td>{i.dueLabel}</td>
                    <td>
                      <StatusTag value={i.status} map={INSTALLMENT_STATUS} />
                    </td>
                    <td className="num font-semibold">
                      {nf.format(remaining)}
                      {i.paidAmount > 0 && <div className="cell-sub num">من {nf.format(i.amount)}</div>}
                    </td>
                    <td>
                      <div className="flex items-center gap-1">
                        <Input
                          name={`alloc_${i.id}`}
                          type="number"
                          min={0}
                          max={remaining}
                          step="0.01"
                          value={v || ""}
                          readOnly={auto}
                          onChange={(e) => setManual({ ...manual, [i.id]: Math.min(remaining, Number(e.target.value) || 0) })}
                          className={`!h-8 !text-xs ${auto ? "bg-mist" : ""}`}
                          placeholder="0"
                        />
                        {!auto && (
                          <button type="button" className="btn btn-ghost btn-xs" onClick={() => setManual({ ...manual, [i.id]: remaining })} title="تخصيص كامل المتبقي">
                            الكل
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
        <div className="grid grid-cols-1 gap-3 border-t border-line px-5 py-3 text-[13px] sm:grid-cols-3">
          <div>
            <div className="text-muted">المبلغ</div>
            <b className="num">{nf.format(effectiveAmount)}</b>
          </div>
          <div>
            <div className="text-muted">المخصص</div>
            <b className="num">{nf.format(allocated)}</b>
          </div>
          <div>
            <div className="text-muted">رصيد دائن غير مخصص</div>
            <b className={`num ${over ? "text-danger" : leftover > 0.009 ? "text-warning" : "text-success"}`}>{nf.format(amountTouched || auto ? leftover : 0)}</b>
          </div>
        </div>
        {over && <div className="px-5 pb-4"><Alert tone="danger">مجموع التخصيص يتجاوز مبلغ السند. قلّل التخصيص أو زد المبلغ.</Alert></div>}
      </Card>

      <Optional title="خيارات إضافية" open={Boolean(prefill.reference)}>
        <FormGrid cols={2}>
          <Field label="المرجع / رقم الحوالة" name="reference">
            <Input name="reference" className="ltr" defaultValue={prefill.reference ?? ""} />
          </Field>
          <Field label="البنك" name="bank">
            <Input name="bank" />
          </Field>
          <Field label="ملاحظات" name="notes">
            <Textarea name="notes" rows={2} />
          </Field>
          <Field label="إيصال أو إثبات التحويل" name="attachment" help="PDF أو صورة حتى 4MB.">
            <input type="file" id="attachment" name="attachment" className="input !py-1.5" accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp" />
          </Field>
        </FormGrid>
      </Optional>

      <FormActions>
        <Link href="/payments" className="btn btn-ghost">
          إلغاء
        </Link>
        <button type="submit" className="btn btn-primary" disabled={pending || over || !tenantId || effectiveAmount <= 0}>
          {pending ? "جارٍ الحفظ…" : "تسجيل سند القبض"}
        </button>
      </FormActions>
    </form>
  );
}
