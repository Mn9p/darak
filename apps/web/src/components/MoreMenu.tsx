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
        // Phones: a sheet above the bottom bar (the button may sit at either edge); larger screens: a dropdown.
        <div className="fixed inset-x-3 bottom-[calc(var(--bnav-h)+var(--safe-b)+10px)] z-50 rounded-2xl border border-line bg-white p-2 shadow-float sm:absolute sm:inset-x-auto sm:bottom-auto sm:left-0 sm:top-full sm:mt-2 sm:min-w-[200px] sm:rounded-[14px] sm:p-1.5">
          {list.map((it, i) =>
            it.href ? (
              <Link key={i} href={it.href} onClick={() => setOpen(false)} className={`block rounded-[10px] px-3 py-3 text-[15px] font-semibold hover:bg-mist sm:py-2.5 sm:text-[14px] ${it.danger ? "text-danger" : "text-text"}`}>
                {it.label}
              </Link>
            ) : (
              <div key={i} className="[&_button]:min-h-0 [&_button]:w-full [&_button]:justify-start [&_button]:rounded-[10px] [&_button]:border-0 [&_button]:bg-transparent [&_button]:px-3 [&_button]:py-3 [&_button]:text-right [&_button]:text-[15px] sm:[&_button]:py-2.5 sm:[&_button]:text-[14px] [&_button:hover]:bg-mist">
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
      <summary className="flex cursor-pointer items-center justify-between px-4 py-3.5 text-[15px] font-bold text-ink md:px-5">
        <span>
          {title}
          {hint && <span className="mr-2 text-[12px] font-normal text-muted">{hint}</span>}
        </span>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="transition group-open:rotate-180" aria-hidden>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </summary>
      <div className="border-t border-line px-4 pb-5 pt-4 md:px-5">{children}</div>
    </details>
  );
}
