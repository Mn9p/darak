"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { LogoMark } from "../Logo";
import { Icon, type IconName } from "../icons";
import type { NavItem, NavSection } from "@/lib/nav";

const HOMES = new Set(["/dashboard", "/owner", "/tenant", "/admin"]);
const DOCK_MAX = 8;

export function normalizeSections(sections: NavSection[] | NavItem[]): NavSection[] {
  return Array.isArray(sections) && sections.length && "items" in (sections[0] as NavSection) ? (sections as NavSection[]) : [{ title: "", items: sections as NavItem[] }];
}

export function isActivePath(pathname: string, href: string) {
  return HOMES.has(href) ? pathname === href : pathname === href || pathname.startsWith(href + "/");
}

export type RoleChip = { label: string; tone: "owner" | "employee" };
export type QuickItem = { href: string; label: string; icon?: IconName };

/**
 * Phone bottom bar: up to four destinations around an optional central "+" (quick add), the last slot opening the full
 * menu whenever there are more sections than fit. Destinations are the user's permitted `bottom` items first.
 */
export function splitBottom(items: NavItem[], withAdd: boolean) {
  const slots = withAdd ? 4 : 5;
  if (items.length <= slots) return { bar: items, more: false };
  const picked = items.filter((i) => i.bottom).slice(0, slots - 1);
  for (const i of items) if (picked.length < slots - 1 && !picked.includes(i)) picked.push(i);
  return { bar: items.filter((i) => picked.includes(i)), more: true };
}

/** Desktop dock: the daily sections (portals: their whole short list); everything else lives in the menu panel. */
export function dockItems(grouped: NavSection[]) {
  const marked = grouped.filter((s) => s.dock).flatMap((s) => s.items);
  const items = marked.length ? marked : grouped.flatMap((s) => s.items);
  const all = grouped.flatMap((s) => s.items);
  const dock = items.slice(0, DOCK_MAX);
  return { dock, more: all.some((i) => !dock.includes(i)) };
}

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((s) => s[0]).join("");
}

/**
 * Navigation for every portal, the same on every screen: daily destinations always in reach (a slim dock on desktop, a
 * bottom bar on phones and tablets) and one menu panel with search and large tiles for everything else (a side panel
 * on desktop, a bottom sheet on phones). Items arrive filtered by permission, so each role sees only its sections.
 */
export function AppNav({
  sections,
  counts,
  home,
  setup,
  quick = [],
  user,
  portalLabel,
  orgName,
  roleChip,
  profileHref,
  helpHref,
  logout,
}: {
  sections: NavSection[] | NavItem[];
  counts?: Record<string, number>;
  home: string;
  setup?: { done: number; total: number };
  quick?: QuickItem[];
  user: { name: string };
  portalLabel?: string;
  orgName?: string | null;
  roleChip: RoleChip;
  profileHref?: string;
  helpHref?: string;
  logout: () => Promise<{ ok: true }>;
}) {
  const pathname = usePathname();
  const grouped = normalizeSections(sections);
  const all = grouped.flatMap((s) => s.items);
  const [sheet, setSheet] = useState<null | "menu" | "add">(null);
  useEffect(() => setSheet(null), [pathname]);

  const count = (it: NavItem) => (it.countKey ? counts?.[it.countKey] : undefined);
  const active = (it: NavItem) => isActivePath(pathname, it.href);
  const pending = (items: NavItem[]) => items.some((i) => (count(i) ?? 0) > 0);

  const { dock, more: dockMore } = dockItems(grouped);
  const dockRest = all.filter((i) => !dock.includes(i));
  const { bar, more: barMore } = splitBottom(all, quick.length > 0);
  const barRest = all.filter((i) => !bar.includes(i));
  const half = Math.ceil(bar.length / 2);

  const badge = (it: NavItem) => (count(it) ?? 0) > 0 && <span className="nav-badge">{count(it)! > 99 ? "99+" : count(it)}</span>;
  const toggle = (s: "menu" | "add") => setSheet((cur) => (cur === s ? null : s));

  const tab = (it: NavItem) => (
    <Link key={it.href} href={it.href} className={`tb-item ${active(it) ? "active" : ""}`} aria-current={active(it) ? "page" : undefined}>
      <span className="tb-ico">
        {it.icon ? <Icon name={it.icon} size={22} /> : null}
        {badge(it)}
      </span>
      <span className="tb-lbl">{it.short ?? it.label}</span>
    </Link>
  );

  return (
    <>
      {/* ── desktop dock ── */}
      <aside className="dock sticky top-0 hidden h-screen flex-none lg:flex" aria-label="القائمة الرئيسية">
        <Link href={home} className="dock-logo" aria-label="دارك — الرئيسية">
          <LogoMark size={36} inverse />
        </Link>
        <span className="najdi dock-roof" aria-hidden />
        <nav className="dock-nav">
          {dock.map((it) => (
            <Link key={it.href} href={it.href} className={`dock-item ${active(it) ? "active" : ""}`} aria-current={active(it) ? "page" : undefined} title={it.label}>
              <span className="dock-ico">
                {it.icon ? <Icon name={it.icon} size={21} /> : null}
                {badge(it)}
              </span>
              <span className="dock-lbl">{it.short ?? it.label}</span>
            </Link>
          ))}
          {dockMore && (
            <button type="button" className={`dock-item ${sheet === "menu" || dockRest.some(active) ? "active" : ""}`} onClick={() => toggle("menu")} aria-expanded={sheet === "menu"} aria-haspopup="dialog">
              <span className="dock-ico">
                <Icon name="grid" size={21} />
                {pending(dockRest) && <span className="nav-dot" aria-hidden />}
              </span>
              <span className="dock-lbl">القائمة</span>
            </button>
          )}
        </nav>
      </aside>

      {/* ── phone / tablet bottom bar ── */}
      <nav className="tb lg:hidden" aria-label="التنقل الرئيسي">
        {bar.slice(0, quick.length ? half : bar.length).map(tab)}
        {quick.length > 0 && (
          <button type="button" className="tb-add" onClick={() => toggle("add")} aria-expanded={sheet === "add"} aria-haspopup="dialog" aria-label="إضافة سريعة">
            <span>
              <Icon name="plus" size={26} />
            </span>
          </button>
        )}
        {quick.length > 0 && bar.slice(half).map(tab)}
        {barMore && (
          <button type="button" className={`tb-item ${barRest.some(active) || sheet === "menu" ? "active" : ""}`} onClick={() => toggle("menu")} aria-expanded={sheet === "menu"} aria-haspopup="dialog">
            <span className="tb-ico">
              <Icon name="grid" size={22} />
              {pending(barRest) && <span className="nav-dot" aria-hidden />}
            </span>
            <span className="tb-lbl">القائمة</span>
          </button>
        )}
      </nav>

      {sheet === "menu" && (
        <MenuPanel
          grouped={grouped}
          active={active}
          count={count}
          user={user}
          orgName={orgName ?? portalLabel ?? "دارك"}
          roleChip={roleChip}
          setup={setup}
          profileHref={profileHref}
          helpHref={helpHref && !all.some((i) => i.href === helpHref) ? helpHref : undefined}
          logout={logout}
          onClose={() => setSheet(null)}
        />
      )}

      {sheet === "add" && (
        <Panel label="إضافة سريعة" onClose={() => setSheet(null)} compact>
          <p className="px-5 pb-1 text-[13px] text-muted">ماذا تريد أن تسجّل؟</p>
          <div className="tiles px-4 pb-5">
            {quick.map((q) => (
              <Link key={q.href} href={q.href} className="tile">
                <span className="tile-ico">
                  <Icon name={q.icon ?? "plus"} size={22} />
                </span>
                <span className="tile-lbl">{q.label}</span>
              </Link>
            ))}
          </div>
        </Panel>
      )}
    </>
  );
}

function MenuPanel({
  grouped,
  active,
  count,
  user,
  orgName,
  roleChip,
  setup,
  profileHref,
  helpHref,
  logout,
  onClose,
}: {
  grouped: NavSection[];
  active: (it: NavItem) => boolean;
  count: (it: NavItem) => number | undefined;
  user: { name: string };
  orgName: string;
  roleChip: RoleChip;
  setup?: { done: number; total: number };
  profileHref?: string;
  helpHref?: string;
  logout: () => Promise<{ ok: true }>;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const total = grouped.reduce((n, s) => n + s.items.length, 0);
  // An untitled lead group (the home page) joins the first titled group instead of sitting alone on a row.
  const merged = useMemo(() => {
    const [first, second, ...rest] = grouped;
    return first && !first.title && second ? [{ ...second, items: [...first.items, ...second.items] }, ...rest] : grouped;
  }, [grouped]);
  const shown = useMemo(() => {
    const term = q.trim();
    if (!term) return merged;
    return merged.map((s) => ({ ...s, items: s.items.filter((i) => i.label.includes(term) || (i.short ?? "").includes(term)) })).filter((s) => s.items.length);
  }, [merged, q]);

  return (
    <Panel label="القائمة" onClose={onClose}>
      <div className="menu-user">
        <span className="avatar sand">{initials(user.name)}</span>
        <span className="min-w-0 flex-1">
          <b className="block truncate text-[15px]">{user.name}</b>
          <span className="block truncate text-[12.5px] text-on-dark-2">{orgName}</span>
        </span>
        <span className={`role-chip ${roleChip.tone}`}>{roleChip.label}</span>
        <span className="najdi" aria-hidden />
      </div>

      {setup && setup.done < setup.total && (
        <Link href="/dashboard" className="menu-setup">
          <span className="flex items-center justify-between text-[13px]">
            <b className="text-ink">أكمل إعداد المكتب</b>
            <span className="text-muted">
              <span className="num">{setup.done}</span> من <span className="num">{setup.total}</span>
            </span>
          </span>
          <span className="bar mt-2 block" role="progressbar" aria-label="إعداد المكتب" aria-valuenow={setup.done} aria-valuemin={0} aria-valuemax={setup.total}>
            <i className="sand" style={{ width: `${(setup.done / setup.total) * 100}%` }} />
          </span>
        </Link>
      )}

      {total > 8 && (
        <label className="menu-search">
          <Icon name="search" size={18} className="text-muted" />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="ابحث في الأقسام…" aria-label="ابحث في الأقسام" />
        </label>
      )}

      <div className="px-4 pb-2">
        {shown.length === 0 && <p className="px-2 py-6 text-center text-[14px] text-muted">لا يوجد قسم بهذا الاسم.</p>}
        {shown.map((sec, gi) => (
          <section key={sec.title || gi} className="menu-group">
            {sec.title && <h3 className="menu-group-title">{sec.title}</h3>}
            <div className="tiles">
              {sec.items.map((it) => (
                <Link key={it.href} href={it.href} className={`tile ${active(it) ? "active" : ""}`} aria-current={active(it) ? "page" : undefined}>
                  <span className="tile-ico">
                    {it.icon ? <Icon name={it.icon} size={22} /> : null}
                    {(count(it) ?? 0) > 0 && <span className="nav-badge">{count(it)! > 99 ? "99+" : count(it)}</span>}
                  </span>
                  <span className="tile-lbl">{it.label}</span>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>

      <div className="menu-foot">
        {profileHref && (
          <Link href={profileHref} className="menu-foot-btn">
            <Icon name="user" size={18} />
            الملف الشخصي
          </Link>
        )}
        {helpHref && (
          <Link href={helpHref} className="menu-foot-btn">
            <Icon name="help" size={18} />
            المساعدة
          </Link>
        )}
        <LogoutButton logout={logout} />
      </div>
    </Panel>
  );
}

function Panel({ label, onClose, children, compact }: { label: string; onClose: () => void; children: ReactNode; compact?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current?.focus();
    return () => {
      window.removeEventListener("keydown", h);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
  return (
    <>
      <div className="overlay" onClick={onClose} />
      <div ref={ref} tabIndex={-1} className={`panel outline-none ${compact ? "compact" : ""}`} role="dialog" aria-modal aria-label={label}>
        <div className="sheet-grip lg:hidden" aria-hidden />
        <div className="panel-head">
          <h2>{label}</h2>
          <button type="button" className="icon-btn !border-0" onClick={onClose} aria-label="إغلاق">
            <Icon name="close" size={20} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto overscroll-contain">{children}</div>
      </div>
    </>
  );
}

function LogoutButton({ logout }: { logout: () => Promise<{ ok: true }> }) {
  const [leaving, setLeaving] = useState(false);
  return (
    <button
      type="button"
      className="menu-foot-btn danger"
      disabled={leaving}
      onClick={async () => {
        if (leaving) return;
        setLeaving(true);
        try {
          await logout();
        } finally {
          window.location.assign("/");
        }
      }}
    >
      <Icon name="logout" size={18} />
      {leaving ? "جارٍ الخروج…" : "تسجيل الخروج"}
    </button>
  );
}
