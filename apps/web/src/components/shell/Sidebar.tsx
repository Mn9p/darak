"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { LogoMark } from "../Logo";
import { Icon } from "../icons";
import type { NavItem, NavSection } from "@/lib/nav";

const STORAGE_KEY = "darak.sidebar";
const MORE_KEY = "darak.nav.more";
const HOMES = new Set(["/dashboard", "/owner", "/tenant", "/admin"]);

export function normalizeSections(sections: NavSection[] | NavItem[]): NavSection[] {
  return Array.isArray(sections) && sections.length && "items" in (sections[0] as NavSection) ? (sections as NavSection[]) : [{ title: "", items: sections as NavItem[] }];
}

export function isActivePath(pathname: string, href: string) {
  return HOMES.has(href) ? pathname === href : pathname.startsWith(href);
}

export function Sidebar({
  sections,
  counts,
  orgName,
  portalLabel,
  setup,
}: {
  sections: NavSection[] | NavItem[];
  counts?: Record<string, number>;
  orgName?: string | null;
  portalLabel?: string;
  /** Office setup progress (staff only); hidden once complete. */
  setup?: { done: number; total: number };
}) {
  const pathname = usePathname();
  const grouped = normalizeSections(sections);
  const secondaryActive = grouped.some((s) => s.secondary && s.items.some((i) => isActivePath(pathname, i.href)));
  const [rail, setRail] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  useEffect(() => {
    try {
      setRail(localStorage.getItem(STORAGE_KEY) === "rail");
      setMoreOpen(secondaryActive || localStorage.getItem(MORE_KEY) === "1");
    } catch {}
  }, [secondaryActive]);

  const toggleRail = () => {
    const v = !rail;
    setRail(v);
    try {
      localStorage.setItem(STORAGE_KEY, v ? "rail" : "full");
    } catch {}
  };
  const toggleMore = () => {
    const v = !moreOpen;
    setMoreOpen(v);
    try {
      localStorage.setItem(MORE_KEY, v ? "1" : "0");
    } catch {}
  };

  const home = grouped[0]?.items[0]?.href ?? "/";

  return (
    <aside className={`sidebar sticky top-0 hidden h-screen flex-none flex-col transition-[width] duration-200 lg:flex ${rail ? "rail" : ""}`} style={{ width: rail ? "var(--sb-rail)" : "var(--sb-w)" }} aria-label="القائمة الرئيسية">
      {/* Brand block */}
      <Link href={home} className={`flex items-center gap-3 border-b border-white/10 ${rail ? "justify-center px-0 py-5" : "px-5 py-5"}`}>
        <LogoMark size={rail ? 32 : 38} inverse />
        {!rail && (
          <span className="leading-none">
            <b className="block text-[24px] tracking-tight">دارك</b>
            <span className="mt-1.5 block text-[11px] text-on-dark-3">{portalLabel ?? "نظام إدارة الأملاك"}</span>
          </span>
        )}
      </Link>
      {orgName && !rail && (
        <div className="mx-3 mt-3 truncate rounded-lg bg-white/[.06] px-3 py-2 text-[12.5px] font-semibold text-[#E3EBE7]" title={orgName}>
          {orgName}
        </div>
      )}

      <nav className={`flex-1 overflow-y-auto pb-4 pt-2 ${rail ? "px-2" : "px-3"}`}>
        {grouped.map((sec) => {
          if (sec.secondary) {
            return (
              <div key="more" className="mt-3 border-t border-white/10 pt-2">
                <button type="button" onClick={toggleMore} className="navitem w-full" aria-expanded={moreOpen}>
                  <Icon name="chevron" size={16} className={`shrink-0 transition ${moreOpen ? "rotate-180" : ""}`} />
                  {!rail && <span>{sec.title}</span>}
                  {rail && <span className="tip">{sec.title}</span>}
                </button>
                {moreOpen && sec.items.map((it) => <Item key={it.href} it={it} active={isActivePath(pathname, it.href)} count={it.countKey ? counts?.[it.countKey] : undefined} rail={rail} />)}
              </div>
            );
          }
          return (
            <div key={sec.title || "top"}>
              {sec.title && <div className="nav-section">{sec.title}</div>}
              {sec.items.map((it) => (
                <Item key={it.href} it={it} active={isActivePath(pathname, it.href)} count={it.countKey ? counts?.[it.countKey] : undefined} rail={rail} />
              ))}
            </div>
          );
        })}
      </nav>

      {setup && setup.done < setup.total && (
        <Link href="/dashboard" className={`block border-t border-white/10 hover:bg-white/[.04] ${rail ? "px-2 py-3" : "px-4 py-3"}`} title={`إعداد المكتب: ${setup.done} من ${setup.total}`}>
          {!rail && (
            <div className="mb-1.5 flex items-center justify-between text-[12px]">
              <span className="font-semibold text-[#E3EBE7]">إعداد المكتب</span>
              <span className="num text-on-dark-3">
                {setup.done} من {setup.total}
              </span>
            </div>
          )}
          <div className="bar on-dark" role="progressbar" aria-label="إعداد المكتب" aria-valuenow={setup.done} aria-valuemin={0} aria-valuemax={setup.total}>
            <i className="sand" style={{ width: `${(setup.done / setup.total) * 100}%` }} />
          </div>
        </Link>
      )}

      <div className={`flex items-center gap-2 border-t border-white/10 py-2.5 text-[11px] text-on-dark-3 ${rail ? "justify-center px-0" : "px-3"}`}>
        {!rail && <span className="flex-1 truncate px-2">إدارة أملاكك. بصورة أوضح.</span>}
        <button type="button" onClick={toggleRail} className="navitem !mb-0 !px-2 !py-1.5" aria-label={rail ? "توسيع القائمة" : "طي القائمة"} title={rail ? "توسيع القائمة" : "طي القائمة"}>
          <Icon name="chevron" size={16} className={`transition ${rail ? "rotate-90" : "-rotate-90"}`} />
        </button>
      </div>
    </aside>
  );
}

function Item({ it, active, count, rail }: { it: NavItem; active: boolean; count?: number; rail: boolean }) {
  return (
    <Link href={it.href} className={`navitem ${active ? "active" : ""}`} aria-current={active ? "page" : undefined}>
      {it.icon ? <Icon name={it.icon} size={17} className="shrink-0 opacity-90" /> : <span className="dot" />}
      {!rail && <span className="truncate">{it.label}</span>}
      {count ? <span className="cnt">{count > 99 ? "99+" : count}</span> : null}
      {rail && <span className="tip">{it.label}</span>}
    </Link>
  );
}
