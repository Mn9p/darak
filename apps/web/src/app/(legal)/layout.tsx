import Link from "next/link";
import { LogoMark } from "@/components/Logo";

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-mist">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-5 py-4">
          <Link href="/" className="flex items-center gap-2.5">
            <LogoMark size={32} />
            <span className="leading-none">
              <b className="block text-[20px] text-ink">دارك</b>
              <span className="mt-1 block text-[11px] text-muted">إدارة أملاكك. بصورة أوضح.</span>
            </span>
          </Link>
          <nav className="flex gap-4 text-[13px] font-semibold text-muted">
            <Link href="/privacy" className="hover:text-brand">الخصوصية</Link>
            <Link href="/terms" className="hover:text-brand">الشروط</Link>
            <Link href="/login" className="hover:text-brand">تسجيل الدخول</Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-8 md:px-5 md:py-10">
        <article className="card prose-ar px-5 py-6 text-[14.5px] leading-8 text-text-2 md:px-8 md:py-8 [&_h1]:mb-2 [&_h1]:text-2xl [&_h1]:font-bold [&_h1]:text-ink [&_h2]:mt-7 [&_h2]:text-lg [&_h2]:font-bold [&_h2]:text-brand [&_ul]:list-disc [&_ul]:pr-6 [&_p]:mb-3">{children}</article>
        <nav className="mt-6 flex items-center justify-center gap-2 text-[12px] text-faint">
          <Link href="/privacy" className="hover:text-brand">الخصوصية</Link>
          <span aria-hidden>·</span>
          <Link href="/terms" className="hover:text-brand">الشروط</Link>
          <span aria-hidden>·</span>
          <span>© {new Date().getFullYear()} دارك</span>
        </nav>
      </main>
    </div>
  );
}
