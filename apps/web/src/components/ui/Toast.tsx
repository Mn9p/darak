"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/** Messages keyed by the `?toast=` search param that server actions append to their redirect. */
const MESSAGES: Record<string, { tone: "success" | "danger" | "info"; text: string }> = {
  saved: { tone: "success", text: "تم الحفظ." },
  created: { tone: "success", text: "تمت الإضافة." },
  updated: { tone: "success", text: "تم تحديث البيانات." },
  approved: { tone: "success", text: "تمت الموافقة." },
  archived: { tone: "info", text: "تمت الأرشفة." },
  cancelled: { tone: "info", text: "تم الإلغاء." },
  reversed: { tone: "info", text: "تم عكس العملية." },
  sent: { tone: "success", text: "تم الإرسال." },
  deleted: { tone: "info", text: "تم الحذف." },
  error: { tone: "danger", text: "تعذر إتمام العملية. لم يتم حفظ أي تغيير." },
};

export function Toast() {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [items, setItems] = useState<{ id: number; tone: string; text: string }[]>([]);

  useEffect(() => {
    const key = sp.get("toast");
    if (!key) return;
    // ?toast=error&msg=… carries the exact Arabic reason from a server action (lib/action-error failBack).
    const msg = sp.get("msg");
    const m = key === "error" && msg ? { tone: "danger" as const, text: msg } : MESSAGES[key] ?? { tone: "info" as const, text: decodeURIComponent(key) };
    const id = Date.now();
    setItems((s) => [...s, { id, ...m }]);
    // Strip the param so a refresh does not replay the toast.
    try {
      const next = new URLSearchParams(sp.toString());
      next.delete("toast");
      next.delete("msg");
      const q = next.toString();
      router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
    } catch {}
    const t = setTimeout(() => setItems((s) => s.filter((i) => i.id !== id)), m.tone === "danger" ? 9000 : 4200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp]);

  if (!items.length) return null;
  return (
    <div className="toast-wrap" aria-live="polite">
      {items.map((i) => (
        <div key={i.id} className={`toast ${i.tone}`}>
          <span className="flex-1">{i.text}</span>
          <button type="button" className="latin text-on-dark-3 hover:text-white" onClick={() => setItems((s) => s.filter((x) => x.id !== i.id))} aria-label="إغلاق">
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
