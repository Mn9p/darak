"use client";

import Link from "next/link";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  // Only Arabic business messages are shown; production errors carry a digest and a generic English text from Next.
  const friendly = error.message && /[؀-ۿ]/.test(error.message) && !error.digest ? error.message : "تعذر إتمام العملية حاليًا. لم يتم حفظ أي تغيير.";
  return (
    <div className="mx-auto mt-10 max-w-lg">
      <div className="card p-8 text-center">
        <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-danger-bg text-2xl"></div>
        <h2 className="text-lg font-bold text-text">حدث خطأ</h2>
        <p className="mt-2 text-[13.5px] text-text-2">{friendly}</p>
        {error.digest && <p className="mt-1 latin text-[11px] text-faint">ref: {error.digest}</p>}
        <div className="mt-5 flex justify-center gap-2">
          <button onClick={reset} className="btn btn-primary btn-sm">
            حاول مرة أخرى
          </button>
          <Link href="/dashboard" className="btn btn-ghost btn-sm">
            الرئيسية
          </Link>
        </div>
      </div>
    </div>
  );
}
