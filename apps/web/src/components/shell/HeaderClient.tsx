"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Icon } from "../icons";
import { CommandPalette } from "./CommandPalette";
import { isActivePath, normalizeSections } from "./Nav";
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
        if (sec.title) out.push({ label: sec.title });
        out.push({ label: it.label, href: it.href });
        const rest = pathname.slice(it.href.length).split("/").filter(Boolean);
        if (rest.length) out.push({ label: rest[0] === "new" ? "جديد" : rest.includes("edit") ? "تعديل" : "تفاصيل" });
        break;
      }
    }
    return out;
  }, [pathname, grouped, home]);

  return (
    <nav className="crumbs hidden min-w-0 lg:flex" aria-label="مسار الصفحة">
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

/** Search pill (desktop) / search icon (phones) + Ctrl/⌘K palette. */
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
      <button type="button" className="search-pill hidden lg:inline-flex" onClick={() => setOpen(true)} aria-label="بحث">
        <Icon name="search" size={18} className="text-muted" />
        <span className="truncate">{searchEnabled ? "ابحث أو انتقل إلى…" : "انتقل إلى…"}</span>
        <span className="kbd">Ctrl K</span>
      </button>
      <button type="button" className="icon-btn lg:hidden" onClick={() => setOpen(true)} aria-label="بحث">
        <Icon name="search" size={21} />
      </button>
      <CommandPalette items={items} searchEnabled={searchEnabled} open={open} onClose={() => setOpen(false)} />
    </>
  );
}
