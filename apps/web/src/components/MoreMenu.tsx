"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";

export interface MoreMenuItem {
  label: string;
  href?: string;
  /** Rendered as-is (e.g. an <ActionButton>) when no href */
  node?: ReactNode;
  danger?: boolean;
}

/** Secondary page actions collapsed behind one "المزيد" button — keeps page headers to a single primary action. */
export function MoreMenu({ items, label = "المزيد" }: { items: (MoreMenuItem | false | "" | 0 | null | undefined)[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const list = items.filter(Boolean) as MoreMenuItem[];
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  if (!list.length) return null;
  return (
    <div className="relative" ref={ref}>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {label}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div className="absolute left-0 top-full z-40 mt-2 min-w-[190px] rounded-xl border border-line bg-white p-1.5 shadow-float">
          {list.map((it, i) =>
            it.href ? (
              <Link key={i} href={it.href} onClick={() => setOpen(false)} className={`block rounded-lg px-3 py-2 text-[13px] font-semibold hover:bg-mist ${it.danger ? "text-danger" : "text-text"}`}>
                {it.label}
              </Link>
            ) : (
              <div key={i} className="[&_button]:w-full [&_button]:justify-start [&_button]:rounded-lg [&_button]:bg-transparent [&_button]:px-3 [&_button]:py-2 [&_button]:text-right [&_button]:text-[13px] [&_button:hover]:bg-mist">
                {it.node}
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}

/** Optional form section, collapsed by default. Keeps forms short: required fields first, extras on demand. */
export function Optional({ title, children, open = false, hint }: { title: string; children: ReactNode; open?: boolean; hint?: string }) {
  return (
    <details className="card group" open={open}>
      <summary className="flex cursor-pointer items-center justify-between px-5 py-3.5 text-[14px] font-bold text-brand">
        <span>
          {title}
          {hint && <span className="mr-2 text-[12px] font-normal text-muted">{hint}</span>}
        </span>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="transition group-open:rotate-180" aria-hidden>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </summary>
      <div className="border-t border-line px-5 pb-5 pt-4">{children}</div>
    </details>
  );
}
