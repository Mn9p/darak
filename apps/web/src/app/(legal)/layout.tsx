import Link from "next/link";
import { LogoMark } from "@/components/Logo";

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-mist">
      <header className="sticky top-0 z-20 border-b border-line bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-[60px] max-w-3xl items-center justify-between gap-3 px-5">
          <Link href="/" className="flex items-center gap-2.5">
            <LogoMark size={34} />
            <b className="text-[19px] text-ink">دارك</b>
          </Link>
          <Link href="/login" className="btn btn-primary btn-sm">
            تسجيل الدخول
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-8 md:px-5 md:py-10">
        <article className="card prose-ar px-5 py-6 text-[14.5px] leading-8 text-text-2 md:px-8 md:py-8 [&_h1]:mb-2 [&_h1]:text-2xl [&_h1]:font-bold [&_h1]:text-ink [&_h2]:mt-7 [&_h2]:text-lg [&_h2]:font-bold [&_h2]:text-ink [&_ul]:list-disc [&_ul]:pr-6 [&_p]:mb-3">{children}</article>
        <nav className="mt-6 flex items-center justify-center gap-2 text-[13px] text-faint">
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
