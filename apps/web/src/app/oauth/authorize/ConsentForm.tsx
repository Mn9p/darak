"use client";

import { useActionState, useEffect } from "react";
import { decideConnection, type ConsentState } from "./actions";

/** Allow / deny buttons. The original request travels as hidden fields and is validated again on the server. */
export function ConsentForm({ params }: { params: Record<string, string> }) {
  const [state, action, pending] = useActionState<ConsentState, FormData>(decideConnection, null);

  // The client's redirect URI is another origin: navigate there directly (a form redirect would hit CSP form-action).
  useEffect(() => {
    if (state?.to) window.location.assign(state.to);
  }, [state]);

  const busy = pending || Boolean(state?.to);
  return (
    <form action={action} className="space-y-3">
      {Object.entries(params).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      {state?.error && <div className="rounded-xl bg-danger-bg px-4 py-3 text-[13px] text-danger">{state.error}</div>}
      <div className="flex flex-wrap gap-2">
        <button type="submit" name="decision" value="allow" className="btn btn-primary flex-1" disabled={busy}>
          {state?.to ? "جارٍ الرجوع للمساعد…" : "السماح بالقراءة"}
        </button>
        <button type="submit" name="decision" value="deny" className="btn btn-outline" disabled={busy}>
          رفض
        </button>
      </div>
    </form>
  );
}
