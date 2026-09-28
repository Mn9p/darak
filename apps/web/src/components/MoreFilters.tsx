import type { ReactNode } from "react";

/** Secondary GET filters, collapsed behind "فلاتر أكثر". Place inside <FilterBar>; opens automatically when one of its filters is active. */
export function MoreFilters({ children, open, label = "فلاتر أكثر" }: { children: ReactNode; open?: boolean; label?: string }) {
  return (
    <details className="order-last basis-full" open={open}>
      <summary className="inline-flex cursor-pointer select-none items-center gap-1 text-[12.5px] font-semibold text-muted hover:text-brand">
        {label}
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </summary>
      <div className="mt-2 flex flex-wrap items-end gap-2">{children}</div>
    </details>
  );
}
