"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Icon, type IconName } from "./icons";

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

export function QuickAdd({ items }: { items: { href: string; label: string; icon?: IconName }[] }) {
  const [open, setOpen] = useState(false);
  const ref = useOutside(() => setOpen(false));
  if (!items.length) return null;
  return (
    <div className="relative" ref={ref}>
      <button type="button" className="btn btn-primary btn-sm" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <Icon name="plus" size={17} />
        إضافة
      </button>
      {open && (
        <div className="menu !inset-auto !left-0 w-56">
          {items.map((it) => (
            <Link key={it.href} href={it.href} onClick={() => setOpen(false)} className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13.5px] font-semibold text-text hover:bg-mist">
              {it.icon && <Icon name={it.icon} size={16} className="text-brand-500" />}
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
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 rounded-xl p-0.5 hover:bg-mist xl:px-1.5 xl:py-1" aria-expanded={open} aria-label="حسابي">
        <span className="avatar sand">{initials}</span>
        <span className="hidden text-right xl:block">
          <span className="block max-w-[160px] truncate text-[13.5px] font-bold leading-tight text-text">{name}</span>
          <span className="block text-[11.5px] text-muted">{roleLabel}</span>
        </span>
      </button>
      {open && (
        <div className="menu !inset-auto !left-0 w-60">
          <div className="border-b border-line-soft px-3 pb-2.5 pt-1.5 xl:hidden">
            <div className="truncate text-[14px] font-bold text-text">{name}</div>
            <div className="text-[12px] text-muted">{roleLabel}</div>
          </div>
          {profileHref && (
            <Link href={profileHref} onClick={() => setOpen(false)} className="mt-1 block rounded-[10px] px-3 py-2.5 text-[14px] font-semibold text-text hover:bg-mist">
              الملف الشخصي
            </Link>
          )}
          <button type="button" onClick={onLogout} disabled={leaving} className="flex w-full items-center gap-2 rounded-[10px] px-3 py-2.5 text-right text-[14px] font-semibold text-danger hover:bg-danger-bg disabled:opacity-60">
            <Icon name="logout" size={18} />
            {leaving ? "جارٍ تسجيل الخروج…" : "تسجيل الخروج"}
          </button>
        </div>
      )}
    </div>
  );
}
