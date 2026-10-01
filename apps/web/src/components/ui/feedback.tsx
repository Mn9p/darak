import type { ReactNode } from "react";
import type { Tone } from "@/lib/constants";

export function Alert({ tone = "info", children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  const map: Record<Tone, string> = {
    info: "bg-info-bg text-info",
    success: "bg-success-bg text-success",
    warning: "bg-warning-bg text-warning",
    danger: "bg-danger-bg text-danger",
    neutral: "bg-mist text-text-2",
    brand: "bg-sand-75 text-brand",
  };
  return (
    <div className={`rounded-2xl px-4 py-3 text-[14px] ${map[tone]}`} role={tone === "danger" ? "alert" : "status"}>
      {title && <div className="font-bold">{title}</div>}
      <div>{children}</div>
    </div>
  );
}

export function Skeleton({ lines = 3, className = "" }: { lines?: number; className?: string }) {
  return (
    <div className={`space-y-2 ${className}`} aria-busy>
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="skeleton h-3.5" style={{ width: `${100 - (i % 3) * 18}%` }} />
      ))}
    </div>
  );
}

export function TableSkeleton({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="p-4" aria-busy>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-3 py-2.5">
          {Array.from({ length: cols }).map((_, c) => (
            <div key={c} className="skeleton h-3.5 flex-1" style={{ maxWidth: c === 0 ? 220 : 140 }} />
          ))}
        </div>
      ))}
    </div>
  );
}
