import Link from "next/link";
import type { ReactNode } from "react";
import type { StatusMeta } from "@/lib/constants";

/** Standard server-action form state used with useActionState */
export type FormState = { error?: string; success?: string } | null;

export function Field({
  label,
  name,
  children,
  help,
  required,
  className = "",
}: {
  label: string;
  name?: string;
  children: ReactNode;
  help?: string;
  required?: boolean;
  className?: string;
}) {
  return (
    <div className={`field ${className}`}>
      <label htmlFor={name} className="label">
        {label} {required && <span className="text-danger">*</span>}
      </label>
      {children}
      {help && <div className="help">{help}</div>}
    </div>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} id={props.id ?? props.name} className={`input ${props.className ?? ""}`} />;
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} id={props.id ?? props.name} className={`textarea ${props.className ?? ""}`} rows={props.rows ?? 3} />;
}

export function Select({
  options,
  placeholder,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & { options: { value: string; label: string }[] | Record<string, string | StatusMeta>; placeholder?: string }) {
  const opts = Array.isArray(options) ? options : Object.entries(options).map(([value, v]) => ({ value, label: typeof v === "string" ? v : v.label }));
  return (
    <select {...props} id={props.id ?? props.name} className={`select ${props.className ?? ""}`}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {opts.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function FormGrid({ children, cols = 2 }: { children: ReactNode; cols?: 1 | 2 | 3 | 4 }) {
  const map = { 1: "grid-cols-1", 2: "grid-cols-1 md:grid-cols-2", 3: "grid-cols-1 md:grid-cols-3", 4: "grid-cols-1 md:grid-cols-2 xl:grid-cols-4" };
  return <div className={`grid gap-4 ${map[cols]}`}>{children}</div>;
}

export function FormActions({ children }: { children: ReactNode }) {
  return <div className="mt-6 flex flex-wrap items-center justify-end gap-2 border-t border-line pt-4">{children}</div>;
}

/** Inline server-action button (e.g. approve / archive) */
export function ActionButton({
  action,
  children,
  className = "btn btn-ghost btn-sm",
  hidden,
  confirm,
}: {
  action: (formData: FormData) => Promise<void>;
  children: ReactNode;
  className?: string;
  hidden?: Record<string, string>;
  confirm?: string;
}) {
  return (
    <form action={action} className="inline" {...(confirm ? { "data-confirm": confirm } : {})}>
      {hidden && Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <button type="submit" className={className}>
        {children}
      </button>
    </form>
  );
}

export function IconButton({ children, href, title }: { children: ReactNode; href: string; title?: string }) {
  return (
    <Link href={href} title={title} className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-mist hover:text-brand">
      {children}
    </Link>
  );
}
