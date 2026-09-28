import Link from "next/link";
import type { ReactNode } from "react";
import { LogoMark } from "@/components/Logo";

/**
 * Split auth layout: brand panel (ink, sand ring motif, tagline) + form panel.
 * Used by login, signup, forgot/reset password. Collapses to a single column under lg.
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
          <h2 className="text-[42px] font-bold leading-[1.2] tracking-tight">
            إدارة أملاكك.
            <br />
            بصورة أوضح.
          </h2>
          <p className="mt-5 text-[15px] leading-8 text-on-dark-2">العقارات والعقود والتحصيل والتقارير في مكان واحد. للمكتب العقاري، وللمالك، وللمستأجر.</p>
          <ul className="mt-8 space-y-3 text-[13.5px] text-on-dark-2">
            <li className="flex items-center gap-3">
              <span className="h-1.5 w-1.5 rounded-full bg-sand" />
              كل عقار وعقد ودفعة في سجل واحد قابل للتدقيق
            </li>
            <li className="flex items-center gap-3">
              <span className="h-1.5 w-1.5 rounded-full bg-sand" />
              تحصيل مبني على الأولوية، وتنبيهات قبل التأخر لا بعده
            </li>
            <li className="flex items-center gap-3">
              <span className="h-1.5 w-1.5 rounded-full bg-sand" />
              بوابات للملاك والمستأجرين تُغني عن المكالمات
            </li>
          </ul>
        </div>
        <div className="text-[12px] text-on-dark-3">كل دار تحت السيطرة.</div>
      </section>

      <section className="flex flex-col items-center justify-center bg-mist px-4 py-10">
        <div className={`w-full ${width}`}>
          <Link href="/" className="mb-7 flex items-center gap-3 lg:hidden">
            <LogoMark size={40} />
            <span>
              <b className="block text-[22px] leading-none text-ink">دارك</b>
              <span className="mt-1 block text-[12px] text-muted">إدارة أملاكك. بصورة أوضح.</span>
            </span>
          </Link>
          <div className="card p-6 md:p-8">
            <h1 className="text-[20px] font-bold text-ink">{title}</h1>
            {subtitle && <p className="mt-1 text-[13px] leading-6 text-muted">{subtitle}</p>}
            {children}
          </div>
          {footer && <div className="mt-4 text-center text-[13px] text-muted">{footer}</div>}
          {aside}
          <nav className="mt-6 flex items-center justify-center gap-2 text-[12px] text-faint">
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
