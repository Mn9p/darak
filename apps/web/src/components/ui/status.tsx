import type { ReactNode } from "react";
import type { StatusMeta, Tone } from "@/lib/constants";

export function Tag({ tone = "neutral", children, plain, className = "" }: { tone?: Tone; children: ReactNode; plain?: boolean; className?: string }) {
  return <span className={`tag tag-${tone} ${plain ? "tag-plain" : ""} ${className}`}>{children}</span>;
}

/** Status colours always go through a constants map so label + colour stay paired. */
export function StatusTag({ value, map, className = "" }: { value: string | null | undefined; map: Record<string, StatusMeta>; className?: string }) {
  if (!value) return <span className="text-faint">—</span>;
  const m = map[value] ?? { label: value, tone: "neutral" as Tone };
  return (
    <Tag tone={m.tone} className={className}>
      {m.label}
    </Tag>
  );
}

export function PriorityPill({ v }: { v: number }) {
  const tone = v >= 60 ? "tag-danger" : v >= 35 ? "tag-warning" : "tag-neutral";
  return <span className={`tag ${tone} tag-plain num`}>{v}</span>;
}

export function Avatar({ name, sand, sm }: { name: string; sand?: boolean; sm?: boolean }) {
  const initials = name.trim().split(/\s+/).slice(0, 2).map((s) => s[0]).join("");
  return <span className={`avatar ${sand ? "sand" : ""} ${sm ? "sm" : ""}`}>{initials}</span>;
}

export function Money({ value, className = "", decimals }: { value: number | null | undefined; className?: string; decimals?: boolean }) {
  if (value === null || value === undefined) return <span className="text-faint">—</span>;
  const f = new Intl.NumberFormat("en-US", { minimumFractionDigits: decimals ? 2 : 0, maximumFractionDigits: decimals ? 2 : 0 }).format(value);
  return (
    <span className={`num ${className}`}>
      {f} <span className="text-[11px] text-muted">ر.س</span>
    </span>
  );
}

export function KV({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-line-soft py-2 text-[13.5px] last:border-b-0">
      <span className="text-muted">{k}</span>
      <span className="font-semibold">{v}</span>
    </div>
  );
}

export function DL({ items, cols = 2 }: { items: { label: string; value: ReactNode }[]; cols?: 1 | 2 | 3 | 4 }) {
  const map = { 1: "grid-cols-1", 2: "grid-cols-1 sm:grid-cols-2", 3: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3", 4: "grid-cols-2 lg:grid-cols-4" };
  return (
    <dl className={`grid gap-x-6 gap-y-3 ${map[cols]}`}>
      {items.map((it, i) => (
        <div key={i} className="min-w-0">
          <dt className="text-[12px] font-semibold text-muted">{it.label}</dt>
          <dd className="truncate text-[14px] font-medium text-text">{it.value ?? <span className="text-faint">—</span>}</dd>
        </div>
      ))}
    </dl>
  );
}
