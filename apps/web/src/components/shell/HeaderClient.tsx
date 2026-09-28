"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Icon } from "../icons";
import { LogoMark } from "../Logo";
import { CommandPalette } from "./CommandPalette";
import { isActivePath, normalizeSections } from "./Sidebar";
import type { NavItem, NavSection } from "@/lib/nav";

/** Breadcrumb trail derived from the nav: Home › Section › Page. Pages add deeper crumbs through PageHeader/HeroHeader. */
export function NavCrumbs({ sections, home }: { sections: NavSection[] | NavItem[]; home: { href: string; label: string } }) {
  const pathname = usePathname();
  const grouped = normalizeSections(sections);
  const crumbs = useMemo(() => {
    const out: { label: string; href?: string }[] = [{ label: home.label, href: home.href }];
    if (pathname === home.href) return out;
    for (const sec of grouped) {
      const it = sec.items.find((i) => i.href !== home.href && isActivePath(pathname, i.href));
      if (it) {
        if (sec.title && !sec.secondary) out.push({ label: sec.title });
        out.push({ label: it.label, href: it.href });
        const rest = pathname.slice(it.href.length).split("/").filter(Boolean);
        if (rest.length) out.push({ label: rest[0] === "new" ? "جديد" : rest.includes("edit") ? "تعديل" : "تفاصيل" });
        break;
      }
    }
    return out;
  }, [pathname, grouped, home]);

  return (
    <nav className="crumbs hidden min-w-0 md:flex" aria-label="مسار الصفحة">
      {crumbs.map((c, i) => {
        const last = i === crumbs.length - 1;
        return (
          <span key={i} className="flex min-w-0 items-center gap-1.5">
            {c.href && !last ? (
              <Link href={c.href} className="truncate">
                {c.label}
              </Link>
            ) : (
              <span className={last ? "cur" : "truncate"}>{c.label}</span>
            )}
            {!last && <Icon name="chevron" size={12} className="sep rotate-90" />}
          </span>
        );
      })}
    </nav>
  );
}

/** Search pill + Ctrl/⌘K palette. */
export function SearchTrigger({ items, searchEnabled }: { items: NavItem[]; searchEnabled: boolean }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);
  return (
    <>
      <button type="button" className="search-pill hidden md:inline-flex" onClick={() => setOpen(true)} aria-label="بحث">
        <Icon name="search" size={16} className="text-faint" />
        <span className="truncate">{searchEnabled ? "ابحث أو انتقل إلى…" : "انتقل إلى…"}</span>
        <span className="kbd">Ctrl K</span>
      </button>
      <button type="button" className="icon-btn md:hidden" onClick={() => setOpen(true)} aria-label="بحث">
        <Icon name="search" size={17} />
      </button>
      <CommandPalette items={items} searchEnabled={searchEnabled} open={open} onClose={() => setOpen(false)} />
    </>
  );
}

export function MobileNav({ sections, orgName, portalLabel }: { sections: NavSection[] | NavItem[]; orgName?: string | null; portalLabel?: string }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  useEffect(() => setOpen(false), [pathname]);
  const grouped = normalizeSections(sections);
  return (
    <div className="lg:hidden">
      <button type="button" onClick={() => setOpen(true)} className="icon-btn" aria-label="القائمة">
        <span className="grid gap-[3px]">
          <span className="block h-0.5 w-4 bg-ink" />
          <span className="block h-0.5 w-4 bg-ink" />
          <span className="block h-0.5 w-4 bg-ink" />
        </span>
      </button>
      {open && (
        <>
          <div className="overlay" onClick={() => setOpen(false)} />
          <div className="sidebar fixed inset-y-0 right-0 z-[71] flex w-[280px] flex-col overflow-y-auto" role="dialog" aria-modal>
            <div className="flex items-center gap-3 border-b border-white/10 px-5 py-4">
              <LogoMark size={32} inverse />
              <span className="leading-none">
                <b className="block text-[20px]">دارك</b>
                <span className="mt-1 block text-[11px] text-on-dark-3">{portalLabel ?? orgName ?? ""}</span>
              </span>
              <button type="button" className="latin mr-auto text-2xl leading-none text-on-dark-2" onClick={() => setOpen(false)} aria-label="إغلاق">
                ×
              </button>
            </div>
            <nav className="flex-1 px-3 py-2">
              {grouped.map((sec) => (
                <div key={sec.title || "top"}>
                  {sec.title && <div className="nav-section">{sec.title}</div>}
                  {sec.items.map((it) => (
                    <Link key={it.href} href={it.href} className={`navitem ${isActivePath(pathname, it.href) ? "active" : ""}`}>
                      {it.icon ? <Icon name={it.icon} size={17} /> : <span className="dot" />}
                      {it.label}
                    </Link>
                  ))}
                </div>
              ))}
            </nav>
          </div>
        </>
      )}
    </div>
  );
}
