"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../icons";
import type { NavItem } from "@/lib/nav";

type Hit = { group: string; label: string; sub?: string; href: string; icon?: NavItem["icon"] };

/**
 * Ctrl/⌘+K palette. Navigation items match instantly; records come from /api/search (staff only).
 * Never blocks navigation: on fetch failure it shows a short message and still offers the full search page.
 */
export function CommandPalette({ items, searchEnabled, open, onClose }: { items: NavItem[]; searchEnabled: boolean; open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [sel, setSel] = useState(0);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const navHits = useMemo<Hit[]>(() => {
    const s = q.trim();
    const list = s ? items.filter((i) => i.label.includes(s) || i.href.includes(s.toLowerCase())) : items.slice(0, 8);
    return list.slice(0, 6).map((i) => ({ group: "الانتقال إلى", label: i.label, href: i.href, icon: i.icon }));
  }, [q, items]);

  const all = useMemo(() => [...navHits, ...hits], [navHits, hits]);

  useEffect(() => {
    if (!open) return;
    setQ("");
    setHits([]);
    setSel(0);
    setFailed(false);
    const t = setTimeout(() => inputRef.current?.focus(), 10);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open || !searchEnabled) return;
    const s = q.trim();
    if (s.length < 2) {
      setHits([]);
      return;
    }
    const t = setTimeout(async () => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      setLoading(true);
      setFailed(false);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(s)}`, { signal: ac.signal });
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as { hits: Hit[] };
        setHits(data.hits ?? []);
      } catch (e) {
        if ((e as Error).name !== "AbortError") setFailed(true);
      } finally {
        setLoading(false);
      }
    }, 180);
    return () => clearTimeout(t);
  }, [q, open, searchEnabled]);

  useEffect(() => setSel(0), [all.length]);

  const go = useCallback(
    (href: string) => {
      onClose();
      router.push(href);
    },
    [onClose, router],
  );

  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowDown") {
        e.preventDefault();
        setSel((s) => Math.min(all.length - 1, s + 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSel((s) => Math.max(0, s - 1));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const hit = all[sel];
        if (hit) go(hit.href);
        else if (searchEnabled && q.trim()) go(`/search?q=${encodeURIComponent(q.trim())}`);
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, all, sel, go, onClose, q, searchEnabled]);

  if (!open) return null;

  let lastGroup = "";
  return (
    <>
      <div className="overlay" onClick={onClose} />
      <div className="cmdk" role="dialog" aria-modal aria-label="البحث السريع">
        <div className="flex items-center gap-2 border-b border-line px-4">
          <Icon name="search" size={18} className="text-faint" />
          <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder={searchEnabled ? "ابحث عن عقار، وحدة، مستأجر، عقد، دفعة… أو انتقل إلى صفحة" : "انتقل إلى صفحة…"} aria-label="بحث" />
          <span className="kbd">Esc</span>
        </div>
        <div className="max-h-[52vh] overflow-y-auto py-1.5">
          {all.length === 0 && (
            <div className="px-5 py-8 text-center text-[13px] text-muted">
              {loading ? "جارٍ البحث…" : failed ? "تعذر الوصول إلى البحث حاليًا. جرّب صفحة البحث الكاملة." : q.trim().length >= 2 ? "لا توجد نتائج مطابقة." : "اكتب حرفين على الأقل للبحث في السجلات."}
            </div>
          )}
          {all.map((h, i) => {
            const showGroup = h.group !== lastGroup;
            lastGroup = h.group;
            return (
              <div key={`${h.href}-${i}`}>
                {showGroup && <div className="grp">{h.group}</div>}
                <Link href={h.href} className={`row ${i === sel ? "sel" : ""}`} onMouseEnter={() => setSel(i)} onClick={onClose}>
                  {h.icon ? <Icon name={h.icon} size={16} className="text-muted" /> : <span className="h-1.5 w-1.5 rounded-full bg-sand" />}
                  <span className="truncate font-semibold">{h.label}</span>
                  {h.sub && <span className="sub">{h.sub}</span>}
                </Link>
              </div>
            );
          })}
        </div>
        {searchEnabled && (
          <div className="flex items-center justify-between border-t border-line px-4 py-2 text-[12px] text-muted">
            <span>
              <span className="kbd">↑↓</span> للتنقل · <span className="kbd">Enter</span> للفتح
            </span>
            {q.trim() && (
              <Link href={`/search?q=${encodeURIComponent(q.trim())}`} className="link" onClick={onClose}>
                البحث الكامل
              </Link>
            )}
          </div>
        )}
      </div>
    </>
  );
}
