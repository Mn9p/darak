"use client";

import { useState } from "react";

/** A working day as four real screens; choosing a moment swaps the screenshot (desktop frame, or phone on phones). */
const STEPS = [
  { when: "صباحًا", title: "لوحة اليوم", body: "ما يحتاج انتباهك اليوم: الوعود والمتابعات والعقود المنتهية والمصروفات المنتظرة.", shot: "dashboard" },
  { when: "قبل الظهر", title: "التحصيل حسب العقار", body: "المتأخر لكل عقار، الأهم أولًا، مع مهلة السداد النظامية وتذكيرات جاهزة بعد مراجعتك.", shot: "collections" },
  { when: "بعد الظهر", title: "العقار في صفحة واحدة", body: "وحداته وعقوده ومطالباته ومستنداته، والإشغال والإيجار على مدار السنة.", shot: "properties" },
  { when: "آخر الشهر", title: "كشف المالك", body: "الإيراد والأتعاب والمصروفات وصافي المستحق، يُعتمد ثم يصل المالك في بوابته.", shot: "statement" },
];

export function DayTour() {
  const [i, setI] = useState(0);
  const s = STEPS[i];
  return (
    <div className="lp-tour">
      <ol className="lp-tour-steps" role="tablist" aria-label="لحظات اليوم">
        {STEPS.map((st, k) => (
          <li key={st.shot}>
            <button type="button" role="tab" aria-selected={k === i} aria-controls="lp-tour-shot" className={k === i ? "on" : ""} onClick={() => setI(k)}>
              <span className="lp-when">{st.when}</span>
              <b>{st.title}</b>
              <span className="lp-tour-body">{st.body}</span>
            </button>
          </li>
        ))}
      </ol>
      <div id="lp-tour-shot" role="tabpanel" className="lp-tour-view">
        <picture key={s.shot}>
          <source media="(max-width: 767px)" srcSet={`/screenshots/${s.shot}-m.webp`} width={390} height={720} />
          <img src={`/screenshots/${s.shot}.webp`} alt={`${s.title} — شاشة من دارك`} width={1366} height={768} loading="lazy" decoding="async" />
        </picture>
      </div>
    </div>
  );
}
