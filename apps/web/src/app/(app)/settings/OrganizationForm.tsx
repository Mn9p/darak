"use client";


import { keepFormValues } from "@/lib/keep-form";
import { useActionState } from "react";
import { Field, Input, FormGrid, FormActions, Alert, Card, type FormState } from "@/components/ui";
import { Optional } from "@/components/MoreMenu";
import { CITIES } from "@/lib/constants";
import { updateOrganization } from "./actions";

export function OrganizationForm({ org, settings }: { org: Record<string, string | null>; settings: Record<string, number | number[] | string> }) {
  const bank = ((settings as Record<string, unknown>).bank ?? {}) as { bankName?: string | null; iban?: string | null; accountName?: string | null };
  const [state, formAction, pending] = useActionState<FormState, FormData>(updateOrganization, null);
  const list = (v: unknown) => (Array.isArray(v) ? v.join(", ") : "");
  return (
    <form onSubmit={keepFormValues(formAction)} className="space-y-4">
      {state?.error && <Alert tone="danger">{state.error}</Alert>}
      {state?.success && <Alert tone="success">{state.success}</Alert>}

      <Card title="المكتب">
        <FormGrid cols={3}>
          <Field label="اسم المكتب" name="name" required>
            <Input name="name" defaultValue={org.name ?? ""} required />
          </Field>
          <Field label="السجل التجاري" name="crNumber">
            <Input name="crNumber" className="ltr" defaultValue={org.crNumber ?? ""} />
          </Field>
          <Field label="الرقم الضريبي" name="vatNumber">
            <Input name="vatNumber" className="ltr" defaultValue={org.vatNumber ?? ""} />
          </Field>
          <Field label="الهاتف" name="phone">
            <Input name="phone" type="tel" defaultValue={org.phone ?? ""} />
          </Field>
          <Field label="البريد الإلكتروني" name="email">
            <Input name="email" type="email" defaultValue={org.email ?? ""} />
          </Field>
          <Field label="المدينة" name="city">
            <Input name="city" list="cities" defaultValue={org.city ?? ""} />
            <datalist id="cities">
              {CITIES.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </Field>
        </FormGrid>
      </Card>

      <Card title="حساب التحصيل" subtitle="يظهر للمستأجرين في بوابتهم تحت «كيف أسدد؟» للتحويل البنكي.">
        <FormGrid cols={3}>
          <Field label="البنك" name="bankName">
            <Input name="bankName" defaultValue={bank.bankName ?? ""} placeholder="مثال: مصرف الراجحي" />
          </Field>
          <Field label="اسم صاحب الحساب" name="bankAccountName">
            <Input name="bankAccountName" defaultValue={bank.accountName ?? ""} />
          </Field>
          <Field label="رقم الآيبان" name="bankIban" help="SA متبوعًا بـ 22 رقمًا">
            <Input name="bankIban" className="ltr latin" defaultValue={bank.iban ?? ""} placeholder="SA0000000000000000000000" />
          </Field>
        </FormGrid>
      </Card>

      <Optional title="خيارات إضافية" hint="حدود الاعتماد، أيام السماح، التنبيهات">
        <div className="space-y-5">
          <div>
            <div className="mb-2 text-[13px] font-bold text-text">حدود الاعتماد</div>
            <FormGrid cols={2}>
              <Field label="الاعتماد التلقائي (ر.س)" name="autoApproveLimit" help="تُعتمد المصروفات تلقائيًا حتى هذا المبلغ.">
                <Input name="autoApproveLimit" type="number" min={0} defaultValue={String(settings.autoApproveLimit ?? 500)} />
              </Field>
              <Field label="حد اعتماد المحاسب (ر.س)" name="managerApprovalLimit" help="يعتمد المحاسب المصروفات حتى هذا المبلغ، وما فوقه يعتمده مدير المكتب.">
                <Input name="managerApprovalLimit" type="number" min={0} defaultValue={String(settings.managerApprovalLimit ?? 5000)} />
              </Field>
            </FormGrid>
          </div>

          <div>
            <div className="mb-2 text-[13px] font-bold text-text">التحصيل والتنبيهات</div>
            <FormGrid cols={3}>
              <Field label="مهلة السداد" name="statutoryGrace" help="المهلة النظامية: 15 يومًا للشهري والربع سنوي، 30 يومًا للنصف سنوي والسنوي، ثم تصبح الدفعة متأخرة ويمكن طلب التنفيذ.">
                <label className="flex min-h-[42px] items-center gap-2 text-[13.5px]">
                  <input type="checkbox" name="statutoryGrace" value="1" defaultChecked={(settings as Record<string, unknown>).statutoryGrace !== false} /> اتباع المهلة النظامية حسب دورية السداد
                </label>
              </Field>
              <Field label="أيام السماح (إن لم تُتبع المهلة النظامية)" name="graceDays">
                <Input name="graceDays" type="number" min={0} max={60} defaultValue={String(settings.graceDays ?? 3)} />
              </Field>
              <Field label="أيام «قريب الاستحقاق»" name="dueSoonDays">
                <Input name="dueSoonDays" type="number" min={1} max={90} defaultValue={String(settings.dueSoonDays ?? 7)} />
              </Field>
              <Field label="ضريبة القيمة المضافة %" name="vatRate">
                <Input name="vatRate" type="number" min={0} max={100} step="0.5" defaultValue={String(settings.vatRate ?? 15)} />
              </Field>
              <Field label="تنبيهات انتهاء العقود (أيام)" name="contractExpiryAlerts" help="افصل بفاصلة، مثال: 90, 60, 30">
                <Input name="contractExpiryAlerts" className="ltr" defaultValue={list(settings.contractExpiryAlerts)} />
              </Field>
              <Field label="تنبيهات انتهاء المستندات (أيام)" name="documentExpiryAlerts" help="مثال: 90, 60, 30, 7">
                <Input name="documentExpiryAlerts" className="ltr" defaultValue={list(settings.documentExpiryAlerts)} />
              </Field>
            </FormGrid>
          </div>
        </div>
      </Optional>

      <FormActions>
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "جارٍ الحفظ…" : "حفظ"}
        </button>
      </FormActions>
    </form>
  );
}
