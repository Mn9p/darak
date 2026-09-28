"use client";


import { keepFormValues } from "@/lib/keep-form";
import { useActionState } from "react";
import { requestAccessAction, type RequestState } from "@/app/request/actions";

/** Public "request an account" form. Offices are opened by the DARAK team after a call. */
export function RequestForm({ cities }: { cities: string[] }) {
  const [state, action, pending] = useActionState<RequestState, FormData>(requestAccessAction, null);

  if (state?.ok) {
    return (
      <div className="request-done" role="status">
        <span className="request-done-mark" aria-hidden>
          ✓
        </span>
        <b>وصلنا طلبك.</b>
        <span>سيتواصل معك فريق دارك خلال يوم عمل لتفعيل مكتبك وشرح الخطوات الأولى.</span>
      </div>
    );
  }

  return (
    <form onSubmit={keepFormValues(action)} className="request-form">
      <label className="request-field">
        <span>اسمك</span>
        <input name="name" autoComplete="name" required maxLength={80} />
      </label>
      <label className="request-field">
        <span>اسم المكتب</span>
        <input name="company" autoComplete="organization" required maxLength={120} placeholder="مكتب … العقاري" />
      </label>
      <label className="request-field">
        <span>رقم الجوال</span>
        <input name="phone" type="tel" inputMode="tel" autoComplete="tel-national" required className="latin" placeholder="05XXXXXXXX" dir="ltr" />
      </label>
      <label className="request-field">
        <span>المدينة</span>
        <select name="city" defaultValue="">
          <option value="">اختر</option>
          {cities.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>
      <label className="request-field request-field-wide">
        <span>عدد العقارات تقريبًا، أو أي سؤال</span>
        <textarea name="message" rows={2} maxLength={600} />
      </label>
      {/* honeypot */}
      <input name="website" tabIndex={-1} autoComplete="off" className="request-hp" aria-hidden="true" />
      {state?.error && <div className="request-error">{state.error}</div>}
      <button type="submit" className="btn btn-accent landing-cta-main request-submit" disabled={pending}>
        {pending ? "جارٍ الإرسال…" : "اطلب حسابًا لمكتبك"}
      </button>
    </form>
  );
}
