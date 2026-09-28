import Link from "next/link";
import { Card } from "@/components/ui";

/**
 * First-run guide shown on the dashboard while the office has no properties yet.
 * Four steps in the order the data must be entered; each row links to the exact form.
 */
export function FirstSteps({
  owners,
  properties,
  units,
  contracts,
  can,
}: {
  owners: number;
  properties: number;
  units: number;
  contracts: number;
  /** What the current user may create (each step's button shows only with its permission). */
  can: { owners: boolean; properties: boolean; units: boolean; contracts: boolean; import: boolean; settings: boolean };
}) {
  const steps = [
    { done: owners > 0, title: "أضف أول مالك", body: "اسم المالك ورقم جواله ونسبة أتعاب الإدارة. الرقم هو مفتاح دخوله إلى بوابته.", href: "/owners/new", cta: "إضافة مالك", allowed: can.owners },
    { done: properties > 0, title: "سجّل العقار", body: "الاسم والنوع والمدينة، ثم اربطه بالمالك بنسبة تملّكه.", href: "/properties/new", cta: "إضافة عقار", allowed: can.properties },
    { done: units > 0, title: "أضف الوحدات", body: "شقق أو مكاتب أو معارض مع الإيجار المستهدف. أدخل الوحدات واحدة أو كنطاق أرقام.", href: "/units/new", cta: "إضافة وحدة", allowed: can.units },
    { done: contracts > 0, title: "أدخل أول عقد", body: "المستأجر يُنشأ من داخل العقد: الوحدة والمدة والدورية، ثم تُولّد الدفعات والتنبيهات عند التفعيل.", href: "/contracts/new", cta: "عقد جديد", allowed: can.contracts },
  ];
  const next = steps.findIndex((s) => !s.done);

  return (
    <Card tone="warm" title="ابدأ تشغيل مكتبك" subtitle="أربع خطوات بالترتيب، وبعدها تعمل لوحة اليوم والتحصيل من تلقاء نفسها.">
      <ol className="grid gap-3 md:grid-cols-2">
        {steps.map((s, i) => {
          const active = i === next;
          return (
            <li key={s.href} className={`flex gap-3 rounded-xl border bg-white p-4 ${active ? "border-sand" : "border-line-soft"}`}>
              <span className={`flex h-8 w-8 flex-none items-center justify-center rounded-full text-[14px] font-bold ${s.done ? "bg-success-bg text-success" : active ? "bg-brand text-white" : "bg-mist text-muted"}`}>
                {s.done ? "✓" : <span className="num">{i + 1}</span>}
              </span>
              <span className="min-w-0 flex-1">
                <span className={`block text-[14.5px] font-bold ${s.done ? "text-muted line-through" : "text-ink"}`}>{s.title}</span>
                <span className="mt-0.5 block text-[13px] leading-6 text-text-2">{s.body}</span>
                {!s.done && s.allowed && (
                  <Link href={s.href} className={`mt-2 inline-flex ${active ? "btn btn-primary btn-sm" : "btn btn-ghost btn-sm"}`}>
                    {s.cta}
                  </Link>
                )}
              </span>
            </li>
          );
        })}
      </ol>
      {(can.import || can.settings) && (
        <p className="mt-3 text-[12.5px] text-muted">
          {can.import && (
            <>
              لديك بيانات في Excel؟{" "}
              <Link href="/import" className="link">
                استوردها دفعة واحدة
              </Link>
              .{" "}
            </>
          )}
          {can.settings && (
            <>
              إعدادات المكتب (السجل التجاري، الرقم الضريبي، حدود الاعتماد) في{" "}
              <Link href="/settings/organization" className="link">
                الإعدادات
              </Link>
              .
            </>
          )}
        </p>
      )}
    </Card>
  );
}
