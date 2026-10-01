import Link from "next/link";
import { Children, Fragment, cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { Icon } from "../icons";

type El = ReactElement<{ children?: ReactNode; colSpan?: number }>;

/** Visible text of a header cell (strings, numbers and nested elements). */
function textOf(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement(node)) return textOf((node as El).props.children);
  return "";
}

/** Column labels from the last header row, expanded by colSpan. */
function headerLabels(children: ReactNode): string[] {
  let labels: string[] = [];
  Children.forEach(children, (part) => {
    if (!isValidElement(part) || part.type !== "thead") return;
    Children.forEach((part as El).props.children, (row) => {
      if (!isValidElement(row) || row.type !== "tr") return;
      const out: string[] = [];
      Children.forEach((row as El).props.children, (cell) => {
        if (!isValidElement(cell)) return;
        const span = Number((cell as El).props.colSpan ?? 1) || 1;
        const text = textOf((cell as El).props.children).replace(/s+/g, " ").trim();
        out.push(text, ...Array(span - 1).fill(""));
      });
      labels = out;
    });
  });
  return labels;
}

/**
 * Copies each column header onto its body cells as data-label, so on phones the CSS can show every row as a
 * labelled card (globals.css: .table-wrap.cards). Plain <tr>/<td> elements (and fragments around them) are labelled;
 * rows rendered by custom components are left as they are.
 */
function labelBody(children: ReactNode, labels: string[]): { out: ReactNode; labelled: number } {
  let labelled = 0;
  const row = (tr: El) => {
    let col = 0;
    const cells = Children.map(tr.props.children, (cell) => {
      if (!isValidElement(cell) || (cell.type !== "td" && cell.type !== "th")) return cell;
      const span = Number((cell as El).props.colSpan ?? 1) || 1;
      const label = span > 1 ? "" : labels[col] ?? "";
      col += span;
      labelled++;
      return cloneElement(cell as ReactElement<Record<string, unknown>>, { "data-label": label });
    });
    return cloneElement(tr, {}, cells);
  };
  const walk = (nodes: ReactNode): ReactNode =>
    Children.map(nodes, (n) => {
      if (!isValidElement(n)) return n;
      if (n.type === "tr") return row(n as El);
      if (n.type === Fragment) return cloneElement(n as El, {}, walk((n as El).props.children));
      return n;
    });
  const out = Children.map(children, (part) => {
    if (!isValidElement(part) || part.type !== "tbody") return part;
    return cloneElement(part as El, {}, walk((part as El).props.children));
  });
  return { out, labelled };
}

/**
 * Data table. On phones (< 640px) rows turn into labelled cards automatically (mobile="cards", the default);
 * pass mobile="scroll" for tables that must keep their grid (ledgers, schedules read across columns).
 */
export function Table({
  children,
  className = "",
  density = "comfortable",
  sticky,
  mobile = "cards",
}: {
  children: ReactNode;
  className?: string;
  density?: "compact" | "comfortable";
  sticky?: boolean;
  mobile?: "cards" | "scroll";
}) {
  let body = children;
  let cards = false;
  if (mobile === "cards") {
    const labels = headerLabels(children);
    if (labels.some(Boolean)) {
      const r = labelBody(children, labels);
      body = r.out;
      cards = r.labelled > 0;
    }
  }
  return (
    <div className={`table-wrap ${sticky ? "sticky" : ""} ${cards ? "cards" : ""} ${className}`}>
      <table className={`table ${density === "compact" ? "compact" : ""}`}>{body}</table>
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
    <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-3 text-[13px] text-muted">
      <span>
        صفحة <b className="num">{page}</b> من <b className="num">{pages}</b> · <b className="num">{total}</b> سجل
      </span>
      <div className="flex gap-1">
        {page > 1 && (
          <Link className="btn btn-ghost btn-sm" href={mk(page - 1)}>
            السابق
          </Link>
        )}
        {page < pages && (
          <Link className="btn btn-ghost btn-sm" href={mk(page + 1)}>
            التالي
          </Link>
        )}
      </div>
    </div>
  );
}

/**
 * Phones: filter controls fill a two-column grid. From sm up the wrapper is display:contents, so the fields sit in the
 * toolbar row; pages may set their own widths (!w-44), otherwise inputs take 16rem and selects 11rem.
 */
function FilterFields({ children }: { children: ReactNode }) {
  // Fields without a page-given width get sensible desktop widths instead of stretching across the toolbar.
  return <div className="grid w-full grid-cols-2 gap-2 sm:contents max-sm:[&_.input]:!w-full max-sm:[&_.select]:!w-full max-sm:[&>*]:min-w-0 max-sm:[&>details]:col-span-2 max-sm:[&>.input]:col-span-2 sm:[&>.input]:w-64 sm:[&>.select]:w-44 sm:[&>.field]:w-48">{children}</div>;
}

/** Simple GET filter bar. Children are inputs/selects named after query params. */
export function FilterBar({ children, base, hasFilters }: { children: ReactNode; base: string; hasFilters?: boolean }) {
  return (
    <form method="get" action={base} className="mb-4 flex flex-wrap items-end gap-2">
      <FilterFields>{children}</FilterFields>
      <button className="btn btn-ghost max-sm:flex-1" type="submit">
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
          <label className="relative w-full min-w-[220px] flex-1 sm:w-auto md:max-w-sm">
            <Icon name="search" size={18} className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-muted" />
            <input name="q" type="search" defaultValue={q ?? ""} placeholder={placeholder} className="input !pr-10" aria-label={placeholder} />
          </label>
        )}
        {children && <FilterFields>{children}</FilterFields>}
        <button className="btn btn-ghost max-sm:flex-1" type="submit">
          تطبيق
        </button>
        {actions && <div className="mr-auto flex items-center gap-2">{actions}</div>}
      </form>
      {(active.length > 0 || count !== undefined) && (
        <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted">
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
