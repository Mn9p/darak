"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

function useOutside(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [onClose]);
  return ref;
}

export function QuickAdd({ items }: { items: { href: string; label: string }[] }) {
  const [open, setOpen] = useState(false);
  const ref = useOutside(() => setOpen(false));
  if (!items.length) return null;
  return (
    <div className="relative" ref={ref}>
      <button type="button" className="btn btn-primary btn-sm" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="latin text-base leading-none">+</span> إضافة
      </button>
      {open && (
        <div className="menu !inset-auto !left-0 w-52">
          {items.map((it) => (
            <Link key={it.href} href={it.href} onClick={() => setOpen(false)} className="block rounded-lg px-3 py-2 text-[13px] font-semibold text-text hover:bg-mist">
              {it.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export function UserMenu({ name, roleLabel, logout, profileHref }: { name: string; roleLabel: string; logout: () => Promise<{ ok: true }>; profileHref?: string }) {
  const [open, setOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const onLogout = async () => {
    if (leaving) return;
    setLeaving(true);
    try {
      await logout();
    } finally {
      // Full navigation clears every client cache and applies the removed cookie.
      window.location.assign("/");
    }
  };
  const ref = useOutside(() => setOpen(false));
  const initials = name.trim().split(/\s+/).slice(0, 2).map((s) => s[0]).join("");
  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 rounded-xl px-1.5 py-1 hover:bg-mist" aria-expanded={open}>
        <span className="avatar sand">{initials}</span>
        <span className="hidden text-right sm:block">
          <span className="block text-[13px] font-bold leading-tight text-text">{name}</span>
          <span className="block text-[11px] text-muted">{roleLabel}</span>
        </span>
      </button>
      {open && (
        <div className="menu !inset-auto !left-0 w-48">
          {profileHref && (
            <Link href={profileHref} onClick={() => setOpen(false)} className="block rounded-lg px-3 py-2 text-[13px] font-semibold text-text hover:bg-mist">
              الملف الشخصي
            </Link>
          )}
          <button type="button" onClick={onLogout} disabled={leaving} className="block w-full rounded-lg px-3 py-2 text-right text-[13px] font-semibold text-danger hover:bg-danger-bg disabled:opacity-60">
            {leaving ? "جارٍ تسجيل الخروج…" : "تسجيل الخروج"}
          </button>
        </div>
      )}
    </div>
  );
}
