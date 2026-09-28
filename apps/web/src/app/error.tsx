"use client";

import Link from "next/link";

/** Error page for every screen outside the staff office (portals, admin, login). Messages are Arabic only. */
export default function RootError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const friendly = error.message && /[؀-ۿ]/.test(error.message) && !error.digest ? error.message : "تعذر عرض هذه الصفحة حاليًا. لم يتم حفظ أي تغيير.";
  return (
    <div className="grid min-h-[70vh] place-items-center p-6">
      <div className="card w-full max-w-md p-8 text-center">
        <h2 className="text-lg font-bold text-text">حدث خطأ</h2>
        <p className="mt-2 text-[13.5px] text-text-2">{friendly}</p>
        {error.digest && <p className="latin mt-1 text-[11px] text-faint">ref: {error.digest}</p>}
        <div className="mt-5 flex justify-center gap-2">
          <button type="button" onClick={reset} className="btn btn-primary btn-sm">
            حاول مرة أخرى
          </button>
          <Link href="/" className="btn btn-ghost btn-sm">
            الصفحة الرئيسية
          </Link>
        </div>
      </div>
    </div>
  );
}
