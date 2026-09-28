"use client";


import { keepFormValues } from "@/lib/keep-form";
import { useActionState, useState } from "react";
import Link from "next/link";
import { Field, Input, Select, FormGrid, FormActions, Alert, Card, type FormState } from "@/components/ui";
import { Optional } from "@/components/MoreMenu";
import { ROLES, STAFF_ROLES, USER_STATUS, NOTIFICATION_CHANNELS, NOTIFICATION_EVENTS } from "@/lib/constants";
import { localPhone } from "@/lib/phone";

type Opt = { id: string; name: string };
const SCOPED = ["PROPERTY_MANAGER"];
const STAFF_ROLE_OPTIONS = STAFF_ROLES.map((r) => ({ value: r, label: ROLES[r].label }));
const PREF_EVENTS = ["CONTRACT_EXPIRING", "INSTALLMENT_OVERDUE", "BROKEN_PROMISE", "DOCUMENT_EXPIRING", "EXPENSE_APPROVAL", "PAYMENT_RECEIVED"];

export function EmployeeForm({
  action,
  employee,
  branches,
  managers,
  properties,
  assignedPropertyIds,
  isSelf,
}: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  employee?: Record<string, unknown> | null;
  branches: Opt[];
  managers: Opt[];
  properties: Opt[];
  assignedPropertyIds?: string[];
  isSelf?: boolean;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, null);
  const e = (employee ?? {}) as Record<string, string | null | undefined>;
  const prefs = (() => {
    try {
      return employee?.preferences ? (JSON.parse(String(employee.preferences)) as { channels?: string[]; events?: string[] }) : {};
    } catch {
      return {} as { channels?: string[]; events?: string[] };
    }
  })();
  const [role, setRole] = useState(e.role ?? "LEASING");
  const [selected, setSelected] = useState<string[]>(assignedPropertyIds ?? []);
  const isNew = !employee?.id;
  const hasOrgExtras = Boolean(e.employeeCode || e.branchId || e.department || e.jobTitle || e.managerId || (e.status && e.status !== "ACTIVE"));
  const scoped = SCOPED.includes(role);

  return (
    <form onSubmit={keepFormValues(formAction)} className="space-y-4">
      {employee?.id ? <input type="hidden" name="id" value={String(employee.id)} /> : null}
      {state?.error && <Alert tone="danger">{state.error}</Alert>}

      <Card title="الموظف">
        <FormGrid cols={2}>
          <Field label="الاسم" name="name" required>
            <Input name="name" required defaultValue={e.name ?? ""} />
          </Field>
          <Field label="الدور" name="role" required help={isSelf ? "لا يمكنك تغيير دورك بنفسك" : undefined}>
            <Select name="role" options={STAFF_ROLE_OPTIONS} value={role} onChange={(ev) => setRole(ev.target.value)} disabled={isSelf} />
            {isSelf && <input type="hidden" name="role" value={role} />}
          </Field>
          <Field label="الجوال" name="phone" required help="رقم الدخول — يصله رمز التحقق عند كل دخول">
            <Input name="phone" type="tel" required inputMode="tel" placeholder="05XXXXXXXX" defaultValue={localPhone(e.phone)} className="ltr" />
          </Field>
          <Field label="البريد الإلكتروني" name="email" help="اختياري">
            <Input name="email" type="email" defaultValue={e.email ?? ""} className="ltr" />
          </Field>
        </FormGrid>
      </Card>

      <Optional title="خيارات إضافية" open={hasOrgExtras}>
        <FormGrid cols={3}>
          <Field label="الحالة" name="status">
            <Select name="status" options={USER_STATUS} defaultValue={e.status ?? "ACTIVE"} disabled={isSelf} />
            {isSelf && <input type="hidden" name="status" value={e.status ?? "ACTIVE"} />}
          </Field>
          <Field label="الرقم الوظيفي" name="employeeCode">
            <Input name="employeeCode" defaultValue={e.employeeCode ?? ""} className="ltr" placeholder="EMP-001" />
          </Field>
          <Field label="المسمى الوظيفي" name="jobTitle">
            <Input name="jobTitle" defaultValue={e.jobTitle ?? ""} />
          </Field>
          <Field label="القسم" name="department">
            <Input name="department" defaultValue={e.department ?? ""} placeholder="التأجير، التحصيل، المالية" />
          </Field>
          <Field label="الفرع" name="branchId">
            <Select name="branchId" options={branches.map((b) => ({ value: b.id, label: b.name }))} placeholder="بدون" defaultValue={e.branchId ?? ""} />
          </Field>
          <Field label="المدير المباشر" name="managerId">
            <Select name="managerId" options={managers.filter((m) => m.id !== employee?.id).map((m) => ({ value: m.id, label: m.name }))} placeholder="بدون" defaultValue={e.managerId ?? ""} />
          </Field>
        </FormGrid>
      </Optional>

      <Optional title="العقارات المسندة" open={scoped || selected.length > 0} hint={scoped ? "هذا الدور يرى العقارات المسندة فقط" : undefined}>
        {properties.length === 0 ? (
          <p className="text-[13px] text-faint">لا توجد عقارات بعد.</p>
        ) : (
          <>
            <div className="mb-2 flex items-center justify-between">
              <span className="help">
                المحدد: <span className="num">{selected.length}</span> من <span className="num">{properties.length}</span>
                {scoped && selected.length === 0 && " — بدون إسناد يرى كل العقارات"}
              </span>
              <span className="flex gap-1">
                <button type="button" className="btn btn-link btn-xs" onClick={() => setSelected(properties.map((p) => p.id))}>
                  تحديد الكل
                </button>
                <button type="button" className="btn btn-link btn-xs" onClick={() => setSelected([])}>
                  إلغاء التحديد
                </button>
              </span>
            </div>
            <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
              {properties.map((p) => (
                <label key={p.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-[13.5px] hover:bg-mist">
                  <input type="checkbox" name="propertyIds" value={p.id} checked={selected.includes(p.id)} onChange={(ev) => setSelected(ev.target.checked ? [...selected, p.id] : selected.filter((x) => x !== p.id))} />
                  {p.name}
                </label>
              ))}
            </div>
          </>
        )}
      </Optional>

      <Optional title="تفضيلات الإشعارات">
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <div className="label">القنوات</div>
            <div className="space-y-1">
              {Object.entries(NOTIFICATION_CHANNELS).map(([k, l]) => (
                <label key={k} className="flex items-center gap-2 text-[13.5px]">
                  <input type="checkbox" name="prefChannels" value={k} defaultChecked={prefs.channels ? prefs.channels.includes(k) : k === "IN_APP"} /> {l}
                </label>
              ))}
            </div>
          </div>
          <div>
            <div className="label">الأحداث</div>
            <div className="space-y-1">
              {PREF_EVENTS.map((k) => (
                <label key={k} className="flex items-center gap-2 text-[13.5px]">
                  <input type="checkbox" name="prefEvents" value={k} defaultChecked={prefs.events ? prefs.events.includes(k) : true} /> {NOTIFICATION_EVENTS[k]}
                </label>
              ))}
            </div>
          </div>
        </div>
      </Optional>

      <FormActions>
        <Link href={employee?.id ? `/employees/${employee.id}` : "/employees"} className="btn btn-ghost">
          إلغاء
        </Link>
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "جارٍ الحفظ…" : isNew ? "إضافة موظف" : "حفظ"}
        </button>
      </FormActions>
    </form>
  );
}
