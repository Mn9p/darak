import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "../icons";

export function Table({ children, className = "", density = "comfortable", sticky }: { children: ReactNode; className?: string; density?: "compact" | "comfortable"; sticky?: boolean }) {
  return (
    <div className={`table-wrap ${sticky ? "sticky" : ""} ${className}`}>
      <table className={`table ${density === "compact" ? "compact" : ""}`}>{children}</table>
    </div>
  );
}

export function Pagination({ page, pageSize, total, base, params }: { page: number; pageSize: number; total: number; base: string; params?: Record<string, string | undefined> }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  const mk = (p: number) => {
    const sp = new URLSearchParams();
    Object.entries(params ?? {}).forEach(([k, v]) => v && k !== "page" && sp.set(k, v));
    sp.set("page", String(p));
    return `${base}?${sp.toString()}`;
  };
  return (
    <div className="flex items-center justify-between border-t border-line px-4 py-3 text-xs text-muted">
      <span>
        صفحة <b className="num">{page}</b> من <b className="num">{pages}</b> · <b className="num">{total}</b> سجل
      </span>
      <div className="flex gap-1">
        {page > 1 && (
          <Link className="btn btn-ghost btn-xs" href={mk(page - 1)}>
            السابق
          </Link>
        )}
        {page < pages && (
          <Link className="btn btn-ghost btn-xs" href={mk(page + 1)}>
            التالي
          </Link>
        )}
      </div>
    </div>
  );
}

/** Simple GET filter bar. Children are inputs/selects named after query params. */
export function FilterBar({ children, base, hasFilters }: { children: ReactNode; base: string; hasFilters?: boolean }) {
  return (
    <form method="get" action={base} className="mb-4 flex flex-wrap items-end gap-2">
      {children}
      <button className="btn btn-ghost btn-sm" type="submit">
        تطبيق
      </button>
      {hasFilters && (
        <Link className="btn btn-link btn-sm" href={base}>
          مسح الفلاتر
        </Link>
      )}
    </form>
  );
}

/**
 * List toolbar: search + filters (GET form) on one row, active-filter chips underneath, actions on the end.
 * Same semantics as FilterBar (no client state): every child input is a query param.
 */
export function DataToolbar({
  base,
  q,
  placeholder = "بحث…",
  children,
  chips,
  actions,
  params,
  count,
}: {
  base: string;
  /** current value of the `q` query param; set to render the search box */
  q?: string | null;
  placeholder?: string;
  children?: ReactNode;
  /** active filters shown as removable chips: label + the param key to drop */
  chips?: { key: string; label: string }[];
  actions?: ReactNode;
  /** all current params — used to build chip-removal links */
  params?: Record<string, string | undefined>;
  /** total matching rows, shown next to the chips */
  count?: number;
}) {
  const drop = (key: string) => {
    const sp = new URLSearchParams();
    Object.entries(params ?? {}).forEach(([k, v]) => v && k !== key && k !== "page" && sp.set(k, v));
    const s = sp.toString();
    return s ? `${base}?${s}` : base;
  };
  const active = chips?.filter((c) => params?.[c.key]) ?? [];
  return (
    <div className="mb-4 space-y-2.5">
      <form method="get" action={base} className="flex flex-wrap items-end gap-2">
        {q !== undefined && (
          <label className="relative min-w-[220px] flex-1 md:max-w-sm">
            <Icon name="search" size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-faint" />
            <input name="q" defaultValue={q ?? ""} placeholder={placeholder} className="input !pr-9" />
          </label>
        )}
        {children}
        <button className="btn btn-ghost btn-sm" type="submit">
          تطبيق
        </button>
        {actions && <div className="mr-auto flex items-center gap-2">{actions}</div>}
      </form>
      {(active.length > 0 || count !== undefined) && (
        <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
          {count !== undefined && (
            <span>
              <b className="num text-text">{count}</b> سجل
            </span>
          )}
          {active.map((c) => (
            <Link key={c.key} href={drop(c.key)} className="chip" title="إزالة الفلتر">
              {c.label}
              <span className="x">×</span>
            </Link>
          ))}
          {active.length > 0 && (
            <Link href={base} className="btn btn-link btn-xs">
              مسح الكل
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
