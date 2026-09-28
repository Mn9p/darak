"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The hero's one orchestrated moment: a property collection board that fills itself.
 * Rows appear, three claims get collected one after another, the collected total counts up.
 * Pure CSS/JS, no libraries; frozen at the final frame when the visitor prefers reduced motion.
 */
const ROWS = [
  { unit: "شقة 12", tenant: "عبدالله المطيري", amount: 27500, due: "1 محرم" },
  { unit: "معرض 3", tenant: "شركة روافد", amount: 84000, due: "5 محرم" },
  { unit: "شقة 7", tenant: "سعود الغامدي", amount: 30000, due: "12 محرم" },
  { unit: "مكتب 21", tenant: "مؤسسة الأفق", amount: 46000, due: "20 محرم" },
  { unit: "شقة 3", tenant: "نواف الحربي", amount: 25000, due: "29 محرم" },
];
const ORDER = [0, 1, 3]; // rows that get collected, in order
const GRAND = ROWS.reduce((s, r) => s + r.amount, 0);
const fmt = (n: number) => n.toLocaleString("en-US");

export function Ledger() {
  const [live, setLive] = useState(false);
  const [paid, setPaid] = useState<number[]>([]);
  const [total, setTotal] = useState(0);
  const shown = useRef(0);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setLive(true);
      setPaid(ORDER);
      return;
    }
    const timers = [
      setTimeout(() => setLive(true), 350),
      ...ORDER.map((_, i) => setTimeout(() => setPaid(ORDER.slice(0, i + 1)), 1500 + i * 800)),
    ];
    return () => timers.forEach(clearTimeout);
  }, []);

  // Count the total up to whatever is collected now.
  useEffect(() => {
    const target = paid.reduce((s, i) => s + ROWS[i].amount, 0);
    const from = shown.current;
    if (from === target) return;
    const start = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / 650);
      const eased = 1 - Math.pow(1 - p, 3);
      const v = Math.round(from + (target - from) * eased);
      shown.current = v;
      setTotal(v);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [paid]);

  const pct = Math.round((total / GRAND) * 100);

  return (
    <div className={`ledger${live ? " is-live" : ""}`} aria-hidden="true" dir="rtl">
      <div className="ledger-head">
        <div>
          <div className="ledger-title">برج النخيل السكني</div>
          <div className="ledger-sub">لوحة التحصيل · محرم</div>
        </div>
        <div className="ledger-total">
          <span className="ledger-total-label">محصّل هذا الشهر</span>
          <span>
            <span className="num ledger-total-value">{fmt(total)}</span>
            <span className="ledger-total-cur"> ر.س</span>
          </span>
        </div>
      </div>
      <ul className="ledger-rows">
        {ROWS.map((r, i) => {
          const done = paid.includes(i);
          return (
            <li key={r.unit} className={`ledger-row${done ? " is-paid" : ""}`} style={{ transitionDelay: live ? `${i * 90}ms` : "0ms" }}>
              <span className="ledger-unit">{r.unit}</span>
              <span className="ledger-tenant">{r.tenant}</span>
              <span className="num ledger-amount">{fmt(r.amount)}</span>
              <span className="ledger-status">
                {done ? (
                  <>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                    مُحصّلة
                  </>
                ) : (
                  <>تستحق {r.due}</>
                )}
              </span>
            </li>
          );
        })}
      </ul>
      <div className="ledger-foot">
        <span className="ledger-bar">
          <span className="ledger-bar-fill" style={{ width: `${pct}%` }} />
        </span>
        <span className="num ledger-pct">{pct}%</span>
      </div>
    </div>
  );
}
