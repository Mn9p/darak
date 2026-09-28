"use client";

import Link from "next/link";
import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import { Alert } from "@/components/ui";
import { displayPhone, localPhone } from "@/lib/phone";
import { requestCodeAction, verifyCodeAction, type LoginState } from "./actions";

type Support = { whatsapp: string | null; phoneDisplay: string | null; email: string | null };

/**
 * Sign-in by mobile number: number → code. The code step looks the same for every number (invite-only: unregistered
 * numbers simply never receive a code), so the code step always explains what to do when nothing arrives.
 * The server decides the step; this component only renders it and keeps the phone across steps.
 */
export function LoginForm({ next, expired, startPhone, support }: { next?: string; expired?: boolean; startPhone?: string; support: Support }) {
  const [reqState, requestCode, requesting] = useActionState<LoginState, FormData>(requestCodeAction, null);
  const [verState, verifyCode, verifying] = useActionState<LoginState, FormData>(verifyCodeAction, null);
  const [navigating, setNavigating] = useState(false);
  const [phoneInput, setPhoneInput] = useState(startPhone ?? "");
  const [code, setCode] = useState("");
  const [seconds, setSeconds] = useState(0);
  const codeRef = useRef<HTMLInputElement>(null);
  const [latest, setLatest] = useState<LoginState>(null);
  const [echo, setEcho] = useState<string | undefined>(undefined);

  // The most recent server answer wins (each action updates its own state; only one changes per submit).
  useEffect(() => {
    if (!reqState) return;
    setLatest(reqState);
    if (reqState.step === "code") {
      setEcho(reqState.echo);
      setCode("");
      setSeconds(reqState.retryAfter ?? 60);
      setTimeout(() => codeRef.current?.focus(), 50);
    }
  }, [reqState]);
  useEffect(() => {
    if (verState) setLatest(verState);
  }, [verState]);
  const done = latest?.ok ? latest : null;
  useEffect(() => {
    if (done?.to) {
      setNavigating(true);
      window.location.assign(done.to); // full navigation so the new cookie applies to every layout
    }
  }, [done]);

  useEffect(() => {
    if (seconds <= 0) return;
    const t = setTimeout(() => setSeconds((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [seconds]);

  const busy = requesting || verifying || navigating;
  const step = latest?.step ?? "phone";
  const phone = latest?.phone ?? "";
  const error = latest?.error;

  if (navigating) {
    return (
      <div className="mt-8 flex flex-col items-center gap-3 py-6 text-center">
        <span className="h-9 w-9 animate-spin rounded-full border-[3px] border-line border-t-brand" aria-hidden />
        <p className="text-[13.5px] text-muted">جارٍ فتح حسابك…</p>
      </div>
    );
  }

  if (step === "code") {
    return (
      <form action={verifyCode} className="mt-6 space-y-4">
        <input type="hidden" name="next" value={next ?? ""} />
        <input type="hidden" name="phone" value={phone} />
        <div className="rounded-xl bg-info-bg px-4 py-2.5 text-[13px] text-info">
          إن كان <b className="num">{displayPhone(phone)}</b> مسجلًا لدى مكتب، يصلك رمز من 6 أرقام برسالة نصية خلال لحظات.
        </div>
        {echo && (
          <div className="rounded-xl border border-dashed border-sand bg-sand-75 px-4 py-3 text-[13px] text-text-2">
            <div className="text-[11.5px] font-bold text-warning">وضع التجربة — لم يُضبط مزود الرسائل بعد</div>
            رمز الدخول: <b className="num text-[18px] tracking-[0.3em] text-ink">{echo}</b>
          </div>
        )}
        <div className="field">
          <label className="label" htmlFor="code">
            رمز التحقق
          </label>
          <input
            ref={codeRef}
            id="code"
            name="code"
            inputMode="numeric"
            pattern="[0-9]{6}"
            maxLength={6}
            autoComplete="one-time-code"
            className="input ltr num text-center text-[22px] tracking-[0.5em]"
            placeholder="••••••"
            value={code}
            onChange={(e) => {
              const v = e.target.value.replace(/\D/g, "").slice(0, 6);
              setCode(v);
              if (v.length === 6) setTimeout(() => e.target.form?.requestSubmit(), 0);
            }}
            autoFocus
            required
          />
          <div className="help">الرمز صالح لمدة 5 دقائق.</div>
          <p className="mt-2 text-[12px] leading-5 text-muted">
            لم يصلك رمز؟ تأكد أن مكتبك سجّل رقمك، أو{" "}
            <Link href="/#request" className="link">
              اطلب حسابًا لمكتب جديد
            </Link>
            {support.whatsapp && (
              <>
                {" "}· واتساب{" "}
                <a href={support.whatsapp} target="_blank" rel="noreferrer" className="link">
                  <span className="num">{support.phoneDisplay}</span>
                </a>
              </>
            )}
            {support.email && (
              <>
                {" "}·{" "}
                <a href={`mailto:${support.email}`} className="link latin">
                  {support.email}
                </a>
              </>
            )}
          </p>
        </div>
        {error && <Alert tone="danger">{error}</Alert>}
        <button type="submit" className="btn btn-primary min-h-[46px] w-full" disabled={busy || code.length !== 6}>
          {verifying ? "جارٍ التحقق…" : "دخول"}
        </button>
        <div className="flex items-center justify-between text-[12.5px]">
          <button type="button" className="link" onClick={() => window.location.assign("/login")} disabled={busy}>
            تغيير الرقم
          </button>
          <button
            type="button"
            className="link disabled:cursor-default disabled:text-faint disabled:no-underline"
            disabled={busy || seconds > 0}
            onClick={() => {
              const fd = new FormData();
              fd.set("phone", phone);
              startTransition(() => requestCode(fd));
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
        </div>
      </form>
    );
  }

  return (
    <form action={requestCode} className="mt-6 space-y-4">
      {expired && !latest && (
        <div className="rounded-xl bg-warning-bg px-4 py-2.5 text-[13px] text-warning">
          <b>انتهت الفترة التجريبية.</b> تواصل مع فريق دارك لتفعيل الاشتراك والعودة إلى بياناتكم كاملة.
        </div>
      )}
      <div className="field">
        <label className="label" htmlFor="phone">
          رقم الجوال
        </label>
        <div className="flex items-stretch gap-2" dir="ltr">
          <input
            id="phone"
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel-national"
            className="input latin flex-1 text-[16px] tracking-wide"
            placeholder="05X XXX XXXX"
            value={phoneInput}
            onChange={(e) => setPhoneInput(e.target.value)}
            onBlur={() => setPhoneInput((v) => localPhone(v))}
            autoFocus
            required
          />
        </div>
        <div className="help">سنرسل رمز دخول برسالة نصية. لا حاجة لكلمة مرور.</div>
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
      <button type="submit" className="btn btn-primary min-h-[46px] w-full" disabled={busy}>
        {requesting ? "جارٍ إرسال الرمز…" : "إرسال رمز الدخول"}
      </button>
      <p className="text-center text-[12px] text-faint">الأرقام المسجلة لدى مكتبك فقط. لا يُرسل رمز لأي رقم غير مسجل.</p>
    </form>
  );
}
