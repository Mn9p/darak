"use client";

import { startTransition, useActionState, useEffect, useState } from "react";
import { Field, Input, FormGrid, FormActions, Alert, type FormState } from "@/components/ui";
import { displayPhone, localPhone } from "@/lib/phone";
import { updateProfile, requestPhoneChangeAction, confirmPhoneChangeAction, type PhoneChangeState } from "./actions";

export function ProfileForm({ user }: { user: { name: string; phone: string; email: string | null } }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(updateProfile, null);
  return (
    <div className="space-y-5">
      <form action={formAction} className="space-y-3">
        {state?.error && <Alert tone="danger">{state.error}</Alert>}
        {state?.success && <Alert tone="success">{state.success}</Alert>}
        <FormGrid cols={2}>
          <Field label="الاسم" name="name" required>
            <Input name="name" defaultValue={user.name} required />
          </Field>
          <Field label="البريد الإلكتروني" name="email" help="اختياري — للإشعارات والمراسلات">
            <Input name="email" type="email" dir="ltr" className="latin" defaultValue={user.email ?? ""} />
          </Field>
        </FormGrid>
        <FormActions>
          <button type="submit" className="btn btn-primary" disabled={pending}>
            {pending ? "جارٍ الحفظ…" : "حفظ"}
          </button>
        </FormActions>
      </form>
      <PhoneChange phone={user.phone} />
    </div>
  );
}

/** Login number: read-only, changed only after a code sent to the new number is confirmed. */
function PhoneChange({ phone }: { phone: string }) {
  const [open, setOpen] = useState(false);
  const [reqState, request, requesting] = useActionState<PhoneChangeState, FormData>(requestPhoneChangeAction, null);
  const [confState, confirm, confirming] = useActionState<PhoneChangeState, FormData>(confirmPhoneChangeAction, null);
  const [latest, setLatest] = useState<PhoneChangeState>(null);
  const [newPhone, setNewPhone] = useState("");
  const [code, setCode] = useState("");
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (!reqState) return;
    setLatest(reqState);
    if (reqState.pending) {
      setCode("");
      setSeconds(reqState.retryAfter ?? 60);
    }
  }, [reqState]);
  useEffect(() => {
    if (confState) setLatest(confState);
  }, [confState]);
  useEffect(() => {
    if (seconds <= 0) return;
    const t = setTimeout(() => setSeconds((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [seconds]);

  const busy = requesting || confirming;
  const pendingPhone = latest?.pending ? latest.phone : undefined;

  if (latest?.success) {
    return (
      <div className="rounded-xl border border-line bg-mist p-4">
        <div className="text-[12px] text-muted">رقم الجوال (للدخول)</div>
        <Alert tone="success">{latest.success}</Alert>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-line bg-mist p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-[12px] text-muted">رقم الجوال (للدخول)</div>
          <div className="num text-[15px] font-semibold text-ink">{displayPhone(phone)}</div>
          <div className="text-[12px] text-faint">يُستخدم لتسجيل الدخول برمز التحقق. لتغييره نرسل رمزًا إلى الرقم الجديد أولًا.</div>
        </div>
        {!open && (
          <button type="button" className="btn btn-outline btn-sm" onClick={() => setOpen(true)}>
            تغيير الرقم
          </button>
        )}
      </div>

      {open && !pendingPhone && (
        <form action={request} className="mt-4 space-y-3">
          {latest?.error && <Alert tone="danger">{latest.error}</Alert>}
          <Field label="الرقم الجديد" name="newPhone" required>
            <Input
              name="newPhone"
              type="tel"
              inputMode="tel"
              dir="ltr"
              className="latin"
              placeholder="05XXXXXXXX"
              value={newPhone}
              onChange={(e) => setNewPhone(e.target.value)}
              onBlur={() => setNewPhone((v) => localPhone(v))}
              autoFocus
              required
            />
          </Field>
          <div className="flex items-center gap-2">
            <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
              {requesting ? "جارٍ إرسال الرمز…" : "إرسال رمز التحقق"}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(false)} disabled={busy}>
              إلغاء
            </button>
          </div>
        </form>
      )}

      {open && pendingPhone && (
        <form action={confirm} className="mt-4 space-y-3">
          <input type="hidden" name="newPhone" value={pendingPhone} />
          <div className="rounded-xl bg-info-bg px-4 py-2.5 text-[13px] text-info">
            أرسلنا رمزًا من 6 أرقام إلى <b className="num">{displayPhone(pendingPhone)}</b>. بعد التأكيد تُنهى جلساتك على الأجهزة الأخرى.
          </div>
          {latest?.echo && (
            <div className="rounded-xl border border-dashed border-sand bg-sand-75 px-4 py-3 text-[13px] text-text-2">
              <div className="text-[11.5px] font-bold text-warning">وضع التجربة — لم يُضبط مزود الرسائل بعد</div>
              رمز التحقق: <b className="num text-[18px] tracking-[0.3em] text-ink">{latest.echo}</b>
            </div>
          )}
          {latest?.error && <Alert tone="danger">{latest.error}</Alert>}
          <Field label="رمز التحقق" name="code" required help="الرمز صالح لمدة 5 دقائق.">
            <Input
              name="code"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              autoComplete="one-time-code"
              dir="ltr"
              className="num text-center tracking-[0.4em]"
              placeholder="••••••"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              autoFocus
              required
            />
          </Field>
          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" className="btn btn-primary btn-sm" disabled={busy || code.length !== 6}>
              {confirming ? "جارٍ التحقق…" : "تأكيد التغيير"}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={busy || seconds > 0}
              onClick={() => {
                const fd = new FormData();
                fd.set("newPhone", pendingPhone);
                startTransition(() => request(fd));
              }}
            >
              {seconds > 0 ? (
                <>
                  إعادة الإرسال بعد <span className="num">{seconds}</span> ث
                </>
              ) : (
                "إعادة إرسال الرمز"
              )}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => window.location.assign("/settings/profile")} disabled={busy}>
              إلغاء
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
