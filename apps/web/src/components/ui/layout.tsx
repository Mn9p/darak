import Link from "next/link";
import type { ReactNode } from "react";
import { LogoMark } from "../Logo";
import { Icon } from "../icons";

export type Crumb = { label: string; href?: string };

/* ───────────── Page scaffolding ───────────── */

export function Breadcrumbs({ items, className = "" }: { items: Crumb[]; className?: string }) {
  if (!items.length) return null;
  return (
    <nav className={`crumbs ${className}`} aria-label="مسار الصفحة">
      {items.map((b, i) => {
        const last = i === items.length - 1;
        return (
          <span key={i} className="flex min-w-0 items-center gap-1.5">
            {b.href && !last ? (
              <Link href={b.href} className="truncate">
                {b.label}
              </Link>
            ) : (
              <span className={last ? "cur" : "truncate"}>{b.label}</span>
            )}
            {!last && <Icon name="chevron" size={12} className="sep -rotate-90 rtl:rotate-90" />}
          </span>
        );
      })}
    </nav>
  );
}

export function PageHeader({
  title,
  subtitle,
  eyebrow,
  actions,
  breadcrumbs,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  eyebrow?: string;
  actions?: ReactNode;
  breadcrumbs?: Crumb[];
}) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        {breadcrumbs && <Breadcrumbs items={breadcrumbs} className="mb-1.5" />}
        {eyebrow && <div className="eyebrow-ar mb-1">{eyebrow}</div>}
        <h1 className="text-[22px] font-bold leading-tight text-ink md:text-[24px]">{title}</h1>
        {subtitle && <p className="mt-1 text-[13.5px] text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Header for 360 pages: title + status + meta row + actions. Sits on the mist background, no card chrome. */
export function HeroHeader({
  title,
  code,
  status,
  meta,
  actions,
  breadcrumbs,
  avatar,
}: {
  title: ReactNode;
  code?: string | null;
  status?: ReactNode;
  meta?: ReactNode[];
  actions?: ReactNode;
  breadcrumbs?: Crumb[];
  avatar?: ReactNode;
}) {
  return (
    <div className="mb-4 border-b border-line">
      {breadcrumbs && <Breadcrumbs items={breadcrumbs} className="mb-3" />}
      <div className="hero-head">
        <div className="flex min-w-0 items-start gap-4">
          {avatar}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="title">{title}</h1>
              {code && <span className="code">{code}</span>}
              {status}
            </div>
            {meta && meta.length > 0 && (
              <div className="meta">
                {meta.filter(Boolean).map((m, i) => (
                  <span key={i}>{m}</span>
                ))}
              </div>
            )}
          </div>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

/** Two-column body for 360 pages: main content + summary side panel. */
export function TwoCol({ children, side, sideWidth = 320 }: { children: ReactNode; side: ReactNode; sideWidth?: number }) {
  return (
    <div className="grid gap-4 xl:items-start" style={{ gridTemplateColumns: `minmax(0,1fr)` }}>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_var(--side)]" style={{ ["--side" as string]: `${sideWidth}px` }}>
        <div className="min-w-0 space-y-4">{children}</div>
        <aside className="space-y-4 xl:sticky xl:top-[calc(var(--hdr-h)+16px)]">{side}</aside>
      </div>
    </div>
  );
}

export function SidePanel({ title, children, actions, tone = "light" }: { title?: ReactNode; children: ReactNode; actions?: ReactNode; tone?: "light" | "dark" | "warm" }) {
  return (
    <Card title={title} actions={actions} tone={tone}>
      {children}
    </Card>
  );
}

export function Card({
  title,
  subtitle,
  actions,
  children,
  className = "",
  padded = true,
  tone = "light",
  hover,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  padded?: boolean;
  tone?: "light" | "dark" | "warm";
  hover?: boolean;
}) {
  const base = tone === "dark" ? "card-dark" : tone === "warm" ? "card-warm" : "card";
  return (
    <section className={`${base} ${hover ? "card-hover" : ""} ${className}`}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 px-5 pb-2 pt-4">
          <div className="min-w-0">
            {title && <h3 className={`text-[15px] font-bold ${tone === "dark" ? "text-sand-200" : "text-brand"}`}>{title}</h3>}
            {subtitle && <p className={`text-xs ${tone === "dark" ? "text-on-dark-2" : "text-muted"}`}>{subtitle}</p>}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={padded ? `px-5 pb-5 ${title || actions ? "pt-1" : "pt-5"}` : ""}>{children}</div>
    </section>
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-mist">{icon && typeof icon !== "string" ? icon : <LogoMark size={30} className="opacity-40" />}</div>
      <h3 className="text-[15px] font-bold text-text">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-[13px] text-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <span className="kbd">{children}</span>;
}

/** Wizard progress. `current` is 0-based. */
export function Stepper({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="stepper" aria-label="خطوات">
      {steps.map((s, i) => (
        <li key={s} className="contents">
          <span className={`step ${i < current ? "done" : i === current ? "cur" : ""}`} aria-current={i === current ? "step" : undefined}>
            <i>{i < current ? "✓" : i + 1}</i>
            <span className="hidden sm:inline">{s}</span>
          </span>
          {i < steps.length - 1 && <span className="line" aria-hidden />}
        </li>
      ))}
    </ol>
  );
}

export function Tabs({ tabs, active, base, sticky }: { tabs: { key: string; label: string; count?: number }[]; active: string; base: string; sticky?: boolean }) {
  return (
    <div className={`tabs mb-4 ${sticky ? "sticky" : ""}`}>
      {tabs.map((t) => (
        <Link key={t.key} href={t.key === tabs[0].key ? base : `${base}?tab=${t.key}`} className={`tab ${active === t.key ? "active" : ""}`}>
          {t.label}
          {t.count !== undefined && <span className="num mr-1.5 text-[11px] text-faint">({t.count})</span>}
        </Link>
      ))}
    </div>
  );
}
