"use client";


import { keepFormValues } from "@/lib/keep-form";
import { useActionState } from "react";
import { Field, Input, Select, FormGrid, Alert, type FormState } from "@/components/ui";
import { connectIntegration } from "./actions";

type CfgField = { key: string; label: string; placeholder?: string; options?: Record<string, string> };

export function ConnectForm({ provider, fields, config, connected }: { provider: string; fields: CfgField[]; config: Record<string, string>; connected: boolean }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(connectIntegration, null);
  return (
    <form onSubmit={keepFormValues(formAction)} className="space-y-3">
      <input type="hidden" name="provider" value={provider} />
      {state?.error && <Alert tone="danger">{state.error}</Alert>}
      {state?.success && <Alert tone="success">{state.success}</Alert>}
      <FormGrid cols={fields.length > 1 ? 2 : 1}>
        {fields.map((f) => (
          <Field key={f.key} label={f.label} name={`${provider}_${f.key}`} required>
            {f.options ? (
              <Select name={f.key} id={`${provider}_${f.key}`} options={f.options} defaultValue={config[f.key] ?? Object.keys(f.options)[0]} />
            ) : (
              <Input name={f.key} id={`${provider}_${f.key}`} defaultValue={config[f.key] ?? ""} placeholder={f.placeholder} className="ltr" required />
            )}
          </Field>
        ))}
      </FormGrid>
      <div className="flex justify-end">
        <button type="submit" className="btn btn-primary btn-sm" disabled={pending}>
          {pending ? "جارٍ الحفظ…" : connected ? "حفظ" : "ربط"}
        </button>
      </div>
    </form>
  );
}
