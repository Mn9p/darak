"use client";

import { useEffect, type ReactNode } from "react";
import { Icon } from "../icons";

/** Side sheet (opens from the leading edge in RTL). Closes on Escape / backdrop click. */
export function Drawer({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", h);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <>
      <div className="overlay" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal aria-label={typeof title === "string" ? title : undefined}>
        <div className="sheet-grip sm:hidden" aria-hidden />
        <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-3 sm:py-4">
          <h3 className="min-w-0 text-[16px] font-bold text-ink">{title}</h3>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="إغلاق">
            <Icon name="close" size={20} />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <footer className="border-t border-line px-5 py-3">{footer}</footer>}
      </aside>
    </>
  );
}
