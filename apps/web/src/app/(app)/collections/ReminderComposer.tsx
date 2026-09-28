"use client";

import { useActionState, useState } from "react";
import { Field, Select, Textarea, Alert, type FormState } from "@/components/ui";
import { draftReminder, sendCustomMessage } from "./actions";

const CHANNELS: Record<string, string> = { WHATSAPP: "واتساب", SMS: "رسالة SMS", EMAIL: "بريد إلكتروني" };
const TONES: Record<string, string> = { soft: "لطيفة", firm: "حازمة ومهذبة" };

/**
 * Drafts a reminder with the assistant, lets the user edit it, then sends through the chosen channel.
 * Nothing is sent without the user pressing "إرسال".
 */
export function ReminderComposer({ caseId, hasPhone, hasEmail }: { caseId: string; hasPhone: boolean; hasEmail: boolean }) {
  const [draftState, draftAction, drafting] = useActionState<FormState, FormData>(draftReminder, null);
  const [sendState, sendAction, sending] = useActionState<FormState, FormData>(sendCustomMessage, null);
  const [channel, setChannel] = useState(hasPhone ? "WHATSAPP" : "EMAIL");
  const [tone, setTone] = useState("soft");
  const [body, setBody] = useState("");
  const draft = draftState?.success ?? "";
  const text = body || draft;
  const channels = Object.entries(CHANNELS).filter(([k]) => (k === "EMAIL" ? hasEmail : hasPhone)).map(([value, label]) => ({ value, label }));

  return (
    <div className="space-y-3 rounded-xl border border-line p-3">
      <form action={draftAction} className="grid grid-cols-2 gap-2">
        <input type="hidden" name="caseId" value={caseId} />
        <Field label="القناة" name="channel">
          <Select name="channel" options={channels} value={channel} onChange={(e) => setChannel(e.target.value)} />
        </Field>
        <Field label="النبرة" name="tone">
          <Select name="tone" options={TONES} value={tone} onChange={(e) => setTone(e.target.value)} />
        </Field>
        <button type="submit" className="btn btn-outline btn-sm col-span-2" disabled={drafting || channels.length === 0}>
          {drafting ? "جارٍ الصياغة…" : "صياغة الرسالة بالمساعد"}
        </button>
      </form>
      {draftState?.error && <Alert tone="danger">{draftState.error}</Alert>}
      {(draft || body) && (
        <form action={sendAction} className="space-y-2">
          <input type="hidden" name="caseId" value={caseId} />
          <input type="hidden" name="channel" value={channel} />
          <Field label="نص الرسالة" name="body" help="راجع النص وعدّله قبل الإرسال.">
            <Textarea name="body" rows={5} value={text} onChange={(e) => setBody(e.target.value)} required />
          </Field>
          {sendState?.error && <Alert tone="danger">{sendState.error}</Alert>}
          {sendState?.success && <Alert tone="success">{sendState.success}</Alert>}
          <button type="submit" className="btn btn-primary btn-sm w-full" disabled={sending || !text.trim()}>
            {sending ? "جارٍ الإرسال…" : `إرسال عبر ${CHANNELS[channel]}`}
          </button>
        </form>
      )}
    </div>
  );
}
