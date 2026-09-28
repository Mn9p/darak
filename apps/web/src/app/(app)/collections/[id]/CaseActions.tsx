"use client";

import { useActionState, useState } from "react";
import { Field, Input, Select, Textarea, Alert, type FormState } from "@/components/ui";
import { COLLECTION_OUTCOMES } from "@/lib/constants";
import { logAction, recordPromise, requestExtension, markDisputed, escalateCase, assignCollector, setNextAction, closeCase } from "../actions";

type Opt = { id: string; name: string };
type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

const CONTACT_TYPES: Record<string, string> = {
  CALL: "اتصال",
  SMS: "رسالة SMS",
  WHATSAPP: "واتساب",
  EMAIL: "بريد إلكتروني",
  VISIT: "زيارة",
  NOTE: "ملاحظة",
};

const PANELS: { key: string; label: string }[] = [
  { key: "log", label: "تسجيل إجراء" },
  { key: "promise", label: "وعد سداد" },
  { key: "extension", label: "طلب تمديد" },
  { key: "dispute", label: "اعتراض" },
  { key: "escalate", label: "تصعيد" },
  { key: "assign", label: "المحصل" },
  { key: "next", label: "الإجراء التالي" },
  { key: "close", label: "إغلاق" },
];

export function CaseActions({
  caseId,
  remaining,
  followUpStatus,
  installmentStatus,
  collectors,
  collectorId,
  nextAction,
  nextActionDate,
  promiseAmount,
  promiseDate,
  canManage,
  enforceable = false,
}: {
  caseId: string;
  remaining: number;
  followUpStatus: string;
  installmentStatus: string;
  collectors: Opt[];
  collectorId: string | null;
  nextAction: string | null;
  nextActionDate: string;
  promiseAmount: number | null;
  promiseDate: string;
  canManage: boolean;
  /** Past the statutory grace period: enforcement through Najiz is possible. */
  enforceable?: boolean;
}) {
  const [panel, setPanel] = useState("log");
  const closed = ["PAID", "CLOSED"].includes(followUpStatus);
  const canClose = ["PAID", "WAIVED"].includes(installmentStatus) && followUpStatus !== "CLOSED";

  return (
    <div className="space-y-3">
      {!canManage ? (
        <p className="text-[13px] text-muted">صلاحيتك للعرض فقط. الإجراءات متاحة للمحصل ومدير المكتب.</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-1">
            {PANELS.map((p) => (
              <button key={p.key} type="button" onClick={() => setPanel(p.key)} className={`btn btn-xs ${panel === p.key ? "btn-primary" : "btn-ghost"}`} disabled={closed && !["assign", "next", "close"].includes(p.key)}>
                {p.label}
              </button>
            ))}
          </div>

          {panel === "log" && (
            <MiniForm action={logAction} caseId={caseId} submit="تسجيل الإجراء">
              <Field label="نوع الإجراء" name="type" required>
                <Select name="type" options={CONTACT_TYPES} defaultValue="CALL" />
              </Field>
              <Field label="النتيجة" name="outcome">
                <Select name="outcome" options={COLLECTION_OUTCOMES} placeholder="بدون نتيجة" />
              </Field>
              <Field label="ملاحظة" name="note">
                <Textarea name="note" rows={3} placeholder="ماذا قال المستأجر؟ ما الاتفاق؟" />
              </Field>
            </MiniForm>
          )}

          {panel === "promise" && (
            <MiniForm action={recordPromise} caseId={caseId} submit="تسجيل الوعد">
              <Field label="المبلغ الموعود (ر.س)" name="amount" required>
                <Input name="amount" type="number" min={1} step="0.01" defaultValue={promiseAmount ?? remaining} required />
              </Field>
              <Field label="تاريخ الوعد" name="promiseDate" required>
                <Input name="promiseDate" type="date" defaultValue={promiseDate} required />
              </Field>
              <Field label="ملاحظة" name="note">
                <Input name="note" placeholder="مثال: سيحول بعد استلام الراتب" />
              </Field>
              <p className="help">إذا مر التاريخ دون سداد يُحتسب وعدًا مكسورًا تلقائيًا وترتفع الأولوية.</p>
            </MiniForm>
          )}

          {panel === "extension" && (
            <MiniForm action={requestExtension} caseId={caseId} submit="تسجيل طلب التمديد">
              <Field label="التمديد حتى" name="until" required>
                <Input name="until" type="date" required />
              </Field>
              <Field label="سبب الطلب" name="note" required>
                <Textarea name="note" rows={3} required placeholder="سبب المستأجر لطلب التمديد" />
              </Field>
              <p className="help">يُسجَّل كوعد سداد بالتاريخ الجديد ويُشعر مدير المكتب.</p>
            </MiniForm>
          )}

          {panel === "dispute" && (
            <MiniForm action={markDisputed} caseId={caseId} submit="تسجيل الاعتراض" tone="danger">
              <Field label="سبب الاعتراض" name="note" required>
                <Textarea name="note" rows={3} required placeholder="مثال: يعترض على مبلغ القسط بسبب خصم متفق عليه" />
              </Field>
            </MiniForm>
          )}

          {panel === "escalate" && (
            <MiniForm action={escalateCase} caseId={caseId} submit="تصعيد" tone="danger">
              <Field label="نوع التصعيد" name="kind" required>
                <Select name="kind" options={{ INTERNAL: "تصعيد داخلي لمدير المكتب", NAJIZ: "تجهيز طلب تنفيذ مالي عبر ناجز" }} defaultValue={enforceable ? "NAJIZ" : "INTERNAL"} />
              </Field>
              <Field label="السبب أو الملاحظة" name="note">
                <Textarea name="note" rows={3} placeholder="اختياري" />
              </Field>
              {enforceable ? <p className="help">انتهت مهلة السداد لهذه الدفعة، فيمكن للمكتب تقديم طلب التنفيذ عبر ناجز بعد موافقة المدير.</p> : <p className="help">يُنشئ إشعارًا ومهمة عاجلة لمدير المكتب.</p>}
            </MiniForm>
          )}

          {panel === "assign" && (
            <MiniForm action={assignCollector} caseId={caseId} submit="حفظ الإسناد">
              <Field label="المحصل المسؤول" name="collectorId">
                <Select name="collectorId" options={collectors.map((c) => ({ value: c.id, label: c.name }))} placeholder="غير مسندة" defaultValue={collectorId ?? ""} />
              </Field>
            </MiniForm>
          )}

          {panel === "next" && (
            <MiniForm action={setNextAction} caseId={caseId} submit="حفظ">
              <Field label="الإجراء التالي" name="nextAction" required>
                <Input name="nextAction" defaultValue={nextAction ?? ""} required placeholder="مثال: اتصال متابعة بعد الوعد" />
              </Field>
              <Field label="تاريخ الإجراء" name="nextActionDate">
                <Input name="nextActionDate" type="date" defaultValue={nextActionDate} />
              </Field>
            </MiniForm>
          )}

          {panel === "close" &&
            (canClose ? (
              <MiniForm action={closeCase} caseId={caseId} submit="إغلاق المطالبة">
                <p className="text-[13px] text-muted">القسط مسدد أو معفى. إغلاق المطالبة يوقف المتابعة ويصفّر الأولوية.</p>
              </MiniForm>
            ) : (
              <Alert tone="neutral">{followUpStatus === "CLOSED" ? "المطالبة مغلقة بالفعل." : "لا يمكن إغلاق المطالبة قبل سداد القسط بالكامل أو إعفائه."}</Alert>
            ))}
        </>
      )}
    </div>
  );
}

function MiniForm({ action, caseId, submit, tone, children }: { action: Action; caseId: string; submit: string; tone?: "danger"; children: React.ReactNode }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, null);
  return (
    <form action={formAction} className="space-y-3 rounded-xl border border-line p-3">
      <input type="hidden" name="caseId" value={caseId} />
      {state?.error && <Alert tone="danger">{state.error}</Alert>}
      {state?.success && <Alert tone="success">{state.success}</Alert>}
      {children}
      <button type="submit" className={`btn w-full ${tone === "danger" ? "btn-danger-soft" : "btn-primary"}`} disabled={pending}>
        {pending ? "جارٍ الحفظ…" : submit}
      </button>
    </form>
  );
}
