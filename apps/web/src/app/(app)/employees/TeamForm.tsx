"use client";

import { keepFormValues } from "@/lib/keep-form";
import { useActionState, useMemo, useState } from "react";
import Link from "next/link";
import { Field, Input, Select, FormGrid, FormActions, Alert, Card, type FormState } from "@/components/ui";
import { Optional } from "@/components/MoreMenu";
import { Icon } from "@/components/icons";
import { USER_STATUS, NOTIFICATION_CHANNELS, NOTIFICATION_EVENTS } from "@/lib/constants";
import { PERMISSION_GROUPS, PRESETS, normalizePermissions, matchPreset, type Permission } from "@/lib/permissions";
import { localPhone } from "@/lib/phone";

type Opt = { id: string; name: string };
type Member = {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  role: string;
  permissions: string;
  allProperties: boolean;
  status: string;
  branchId: string | null;
  department: string | null;
  jobTitle: string | null;
  employeeCode: string | null;
  managerId: string | null;
  preferences: string;
};

const PREF_EVENTS = ["CONTRACT_EXPIRING", "INSTALLMENT_OVERDUE", "BROKEN_PROMISE", "DOCUMENT_EXPIRING", "EXPENSE_APPROVAL", "PAYMENT_RECEIVED"];
const DEFAULT_PRESET = PRESETS.find((p) => p.key === "COLLECTION")!;

/** Removing a permission also removes what depends on it (no "approve" without "view"). */
function withoutPermission(list: Permission[], p: Permission): Permission[] {
  const [mod, act] = p.split(".");
  return list.filter((x) => {
    if (x === p) return false;
    if (act === "view" && x.startsWith(`${mod}.`)) return false;
    if (p === "statements.manage" && x === "statements.approve") return false;
    return true;
  });
}

export function TeamForm({
  action,
  member,
  branches,
  managers,
  properties,
  assignedPropertyIds,
  isSelf,
}: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  member?: Member | null;
  branches: Opt[];
  managers: Opt[];
  properties: Opt[];
  assignedPropertyIds?: string[];
  isSelf?: boolean;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, null);
  const isNew = !member?.id;
  const prefs = useMemo(() => {
    try {
      return member?.preferences ? (JSON.parse(member.preferences) as { channels?: string[]; events?: string[] }) : {};
    } catch {
      return {} as { channels?: string[]; events?: string[] };
    }
  }, [member?.preferences]);

  const [role, setRole] = useState(member?.role ?? "EMPLOYEE");
  const [perms, setPerms] = useState<Permission[]>(member && member.role === "EMPLOYEE" ? normalizePermissions(member.permissions) : DEFAULT_PRESET.permissions);
  const [allProperties, setAllProperties] = useState(member ? member.allProperties : DEFAULT_PRESET.allProperties);
  const [selected, setSelected] = useState<string[]>(assignedPropertyIds ?? []);
  const preset = matchPreset(perms, allProperties);
  const locked = Boolean(isSelf);
  const hasOrgExtras = Boolean(member && (member.employeeCode || member.branchId || member.department || member.managerId || member.status !== "ACTIVE"));

  const toggle = (p: Permission, on: boolean) => setPerms((cur) => normalizePermissions(on ? [...cur, p] : withoutPermission(cur, p)));
  const toggleGroup = (keys: Permission[], on: boolean) => setPerms((cur) => normalizePermissions(on ? [...cur, ...keys] : keys.reduce(withoutPermission, cur)));
  const applyPreset = (key: string) => {
    const p = PRESETS.find((x) => x.key === key);
    if (!p) return;
    setPerms(p.permissions);
    setAllProperties(p.allProperties);
  };

  return (
    <form onSubmit={keepFormValues(formAction)} className="space-y-4">
      {member?.id ? <input type="hidden" name="id" value={member.id} /> : null}
      {state?.error && <Alert tone="danger">{state.error}</Alert>}

      <Card title="بيانات العضو" subtitle="يدخل برقم جواله ورمز يصله برسالة نصية — لا كلمات مرور">
        <FormGrid cols={2}>
          <Field label="الاسم" name="name" required>
            <Input name="name" required defaultValue={member?.name ?? ""} autoComplete="off" />
          </Field>
          <Field label="رقم الجوال" name="phone" required help="رقم الدخول">
            <Input name="phone" type="tel" required inputMode="tel" placeholder="05XXXXXXXX" defaultValue={localPhone(member?.phone)} className="ltr" />
          </Field>
          <Field label="المسمى الوظيفي" name="jobTitle" help="اختياري، يظهر بجانب الاسم">
            <Input name="jobTitle" defaultValue={member?.jobTitle ?? ""} placeholder="مثال: محصل، محاسبة، مسؤول تأجير" />
          </Field>
          <Field label="البريد الإلكتروني" name="email" help="اختياري">
            <Input name="email" type="email" defaultValue={member?.email ?? ""} className="ltr" />
          </Field>
        </FormGrid>
      </Card>

      <Card title="الدور" subtitle={locked ? "لا يمكنك تغيير دورك أو صلاحياتك بنفسك" : "اختر ما يناسب مسؤولية هذا الشخص في المكتب"}>
        {locked && <input type="hidden" name="role" value={role} />}
        <div className="grid gap-3 md:grid-cols-2" role="radiogroup" aria-label="الدور">
          {[
            { value: "ACCOUNT_OWNER", title: "صاحب الحساب", icon: "key" as const, body: "يرى كل شيء ويعتمد ما فوق الحدود، ويدير فريق العمل والإعدادات والاشتراك." },
            { value: "EMPLOYEE", title: "موظف", icon: "user" as const, body: "يرى ويعمل فقط فيما تمنحه له أدناه، على كل العقارات أو على عقارات تختارها." },
          ].map((r) => (
            <label key={r.value} className={`role-card ${role === r.value ? "on" : ""} ${locked ? "is-locked" : ""}`}>
              <input type="radio" name="role" value={r.value} checked={role === r.value} onChange={() => setRole(r.value)} disabled={locked} className="sr-only" />
              <span className="role-card-ico">
                <Icon name={r.icon} size={22} />
              </span>
              <span className="min-w-0">
                <b className="block text-[16px] text-ink">{r.title}</b>
                <span className="mt-0.5 block text-[13.5px] leading-6 text-muted">{r.body}</span>
              </span>
              <span className="role-card-check" aria-hidden>
                <Icon name="check" size={16} />
              </span>
            </label>
          ))}
        </div>
      </Card>

      {role === "EMPLOYEE" && (
        <>
          <Card
            title="ما يستطيع فعله"
            subtitle={preset ? `مطابق لقالب «${preset.label}»` : `صلاحيات مخصصة · ${perms.length - 1} صلاحية`}
          >
            {locked ? (
              perms.map((p) => <input key={p} type="hidden" name="permissions" value={p} />)
            ) : (
              <>
                <div className="mb-4">
                  <div className="label">ابدأ من قالب جاهز ثم عدّل ما تريد</div>
                  <div className="fchips flex-wrap">
                    {PRESETS.map((p) => (
                      <button key={p.key} type="button" className={`fchip ${preset?.key === p.key ? "on" : ""}`} onClick={() => applyPreset(p.key)} title={p.description}>
                        {preset?.key === p.key && <Icon name="check" size={14} />}
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  {PERMISSION_GROUPS.map((g) => {
                    const keys = g.items.map((i) => i.key);
                    const on = keys.filter((k) => perms.includes(k)).length;
                    return (
                      <fieldset key={g.key} className={`perm-group ${on ? "has-on" : ""}`}>
                        <legend className="sr-only">{g.label}</legend>
                        <div className="perm-group-head">
                          <b>{g.label}</b>
                          <span className="num text-[12.5px] text-muted">
                            {on}/{keys.length}
                          </span>
                          <button type="button" className="btn btn-link btn-xs mr-auto" onClick={() => toggleGroup(keys, on < keys.length)}>
                            {on < keys.length ? "الكل" : "لا شيء"}
                          </button>
                        </div>
                        {g.items.map((it) => (
                          <label key={it.key} className="perm-row">
                            <input type="checkbox" name="permissions" value={it.key} checked={perms.includes(it.key)} onChange={(ev) => toggle(it.key, ev.target.checked)} />
                            <span>{it.label}</span>
                          </label>
                        ))}
                      </fieldset>
                    );
                  })}
                </div>
                <p className="help mt-3">إدارة فريق العمل والإعدادات والاشتراك والتكاملات تبقى لصاحب الحساب وحده.</p>
              </>
            )}
          </Card>

          <Card title="العقارات" subtitle={allProperties ? "يعمل على كل عقارات المكتب" : `يعمل على ${selected.length} من ${properties.length} عقار فقط`}>
            {locked && (
              <>
                <input type="hidden" name="access" value={allProperties ? "all" : "selected"} />
                {selected.map((id) => (
                  <input key={id} type="hidden" name="propertyIds" value={id} />
                ))}
              </>
            )}
            <div className="seg" role="radiogroup" aria-label="نطاق العقارات">
              <label className={allProperties ? "on" : ""}>
                <input type="radio" name={locked ? undefined : "access"} value="all" checked={allProperties} onChange={() => setAllProperties(true)} disabled={locked} className="sr-only" />
                كل العقارات
              </label>
              <label className={!allProperties ? "on" : ""}>
                <input type="radio" name={locked ? undefined : "access"} value="selected" checked={!allProperties} onChange={() => setAllProperties(false)} disabled={locked} className="sr-only" />
                عقارات محددة
              </label>
            </div>
            {!allProperties && !locked && (
              <div className="mt-4">
                {properties.length === 0 ? (
                  <p className="text-[14px] text-muted">لا توجد عقارات بعد. اختر «كل العقارات» الآن، وحدّد النطاق لاحقًا.</p>
                ) : (
                  <>
                    <div className="mb-2 flex items-center justify-between">
                      <span className="help !mt-0">
                        المحدد: <span className="num">{selected.length}</span> من <span className="num">{properties.length}</span>
                      </span>
                      <span className="flex gap-3">
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
                        <label key={p.id} className="perm-row rounded-xl border border-line px-3">
                          <input type="checkbox" name="propertyIds" value={p.id} checked={selected.includes(p.id)} onChange={(ev) => setSelected(ev.target.checked ? [...selected, p.id] : selected.filter((x) => x !== p.id))} />
                          <span>{p.name}</span>
                        </label>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
          </Card>
        </>
      )}

      <Optional title="بيانات إضافية" open={hasOrgExtras}>
        <FormGrid cols={3}>
          <Field label="الحالة" name="status">
            <Select name="status" options={USER_STATUS} defaultValue={member?.status ?? "ACTIVE"} disabled={locked} />
            {locked && <input type="hidden" name="status" value={member?.status ?? "ACTIVE"} />}
          </Field>
          <Field label="الرقم الوظيفي" name="employeeCode">
            <Input name="employeeCode" defaultValue={member?.employeeCode ?? ""} className="ltr" placeholder="EMP-001" />
          </Field>
          <Field label="القسم" name="department">
            <Input name="department" defaultValue={member?.department ?? ""} placeholder="التأجير، التحصيل، المالية" />
          </Field>
          <Field label="الفرع" name="branchId">
            <Select name="branchId" options={branches.map((b) => ({ value: b.id, label: b.name }))} placeholder="بدون" defaultValue={member?.branchId ?? ""} />
          </Field>
          <Field label="المدير المباشر" name="managerId">
            <Select name="managerId" options={managers.filter((m) => m.id !== member?.id).map((m) => ({ value: m.id, label: m.name }))} placeholder="بدون" defaultValue={member?.managerId ?? ""} />
          </Field>
        </FormGrid>
      </Optional>

      <Optional title="تفضيلات الإشعارات">
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <div className="label">القنوات</div>
            <div className="space-y-1">
              {Object.entries(NOTIFICATION_CHANNELS).map(([k, l]) => (
                <label key={k} className="perm-row">
                  <input type="checkbox" name="prefChannels" value={k} defaultChecked={prefs.channels ? prefs.channels.includes(k) : k === "IN_APP"} /> <span>{l}</span>
                </label>
              ))}
            </div>
          </div>
          <div>
            <div className="label">الأحداث</div>
            <div className="space-y-1">
              {PREF_EVENTS.map((k) => (
                <label key={k} className="perm-row">
                  <input type="checkbox" name="prefEvents" value={k} defaultChecked={prefs.events ? prefs.events.includes(k) : true} /> <span>{NOTIFICATION_EVENTS[k]}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
      </Optional>

      <FormActions>
        <Link href={member?.id ? `/employees/${member.id}` : "/employees"} className="btn btn-ghost">
          إلغاء
        </Link>
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "جارٍ الحفظ…" : isNew ? "إضافة إلى الفريق" : "حفظ التغييرات"}
        </button>
      </FormActions>
    </form>
  );
}
