import Link from "next/link";
import type { ReactNode } from "react";
import { LogoMark } from "@/components/Logo";

const ROLES_LINE = [
  { who: "صاحب الحساب", what: "يرى المكتب كاملًا ويدير فريقه وصلاحياتهم" },
  { who: "الموظف", what: "يرى عمله فقط: الأقسام والعقارات التي مُنحت له" },
  { who: "المالك والمستأجر", what: "بوابة خاصة برقم الجوال المسجل لدى المكتب" },
];

/**
 * Sign-in layout: brand panel (ink, ring motif, Najdi roofline) + form panel on the mist workspace.
 * Collapses to a single centred column under lg.
 */
export function AuthShell({ title, subtitle, children, width = "max-w-md", footer, aside }: { title: string; subtitle?: string; children: ReactNode; width?: string; footer?: ReactNode; aside?: ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <section className="brand-panel hidden p-12 lg:flex lg:flex-col lg:justify-between">
        <Link href="/" className="flex items-center gap-3">
          <LogoMark size={44} inverse />
          <b className="text-[30px] tracking-tight">دارك</b>
        </Link>
        <div className="max-w-md">
          <h2 className="text-[40px] font-bold leading-[1.25] tracking-tight">
            إدارة أملاكك.
            <br />
            بصورة أوضح.
          </h2>
          <p className="mt-5 text-[15px] leading-8 text-on-dark-2">رقم جوال واحد يفتح لكل شخص ما يخصه:</p>
          <dl className="mt-5 space-y-3">
            {ROLES_LINE.map((r) => (
              <div key={r.who} className="notch ps-5">
                <dt className="text-[14.5px] font-bold text-sand-200">{r.who}</dt>
                <dd className="text-[13.5px] text-on-dark-2">{r.what}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div>
          <span className="najdi text-sand/25" aria-hidden />
          <div className="mt-4 text-[12px] text-on-dark-3">كل دار تحت السيطرة.</div>
        </div>
      </section>

      <section className="flex flex-col items-center justify-center bg-mist px-4 py-10">
        <div className={`w-full ${width}`}>
          <Link href="/" className="mb-7 flex items-center justify-center gap-3 lg:hidden">
            <LogoMark size={42} />
            <span>
              <b className="block text-[24px] leading-none text-ink">دارك</b>
              <span className="mt-1.5 block text-[12.5px] text-muted">إدارة أملاكك. بصورة أوضح.</span>
            </span>
          </Link>
          <div className="card p-5 shadow-[var(--shadow-card)] sm:p-8">
            <h1 className="text-[21px] font-bold text-ink">{title}</h1>
            {subtitle && <p className="mt-1.5 text-[13.5px] leading-7 text-muted">{subtitle}</p>}
            {children}
          </div>
          {footer && <div className="mt-5 text-center text-[13.5px] leading-7 text-muted">{footer}</div>}
          {aside}
          <nav className="mt-6 flex items-center justify-center gap-2 text-[12.5px] text-faint">
            <Link href="/" className="hover:text-brand">
              الصفحة الرئيسية
            </Link>
            <span aria-hidden>·</span>
            <Link href="/privacy" className="hover:text-brand">
              الخصوصية
            </Link>
            <span aria-hidden>·</span>
            <Link href="/terms" className="hover:text-brand">
              الشروط
            </Link>
          </nav>
        </div>
      </section>
    </div>
  );
}
