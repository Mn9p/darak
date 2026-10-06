import Link from "next/link";
import { LogoMark } from "@/components/Logo";
import { Icon, type IconName } from "@/components/icons";
import { RequestForm } from "./RequestForm";
import { Reveal } from "./Reveal";
import { thmanyahSans, thmanyahDisplay } from "./fonts";
import { CITIES } from "@/lib/constants";
import { supportContact } from "@/lib/support";

/**
 * Public landing page. Light marketing page on the brand palette (see landing.css): floating pill header, centred
 * hero over a dotted field with the dashboard in a browser frame, a module strip, the "who sees what" cards, three
 * numbers, four steps, a day in the product as alternating rows, an ink band on data safety, the capability grid,
 * an FAQ and the request-an-account card. Screenshots: /public/screenshots (desktop *.webp, phone *-m.webp).
 */

const MODULES: { label: string; icon: IconName }[] = [
  { label: "العقارات والوحدات", icon: "building" },
  { label: "العقود", icon: "file" },
  { label: "التحصيل", icon: "coins" },
  { label: "سندات القبض", icon: "wallet" },
  { label: "كشوف حساب الملاك", icon: "bank" },
  { label: "المصروفات", icon: "receipt" },
  { label: "المهام", icon: "tasks" },
  { label: "المستندات", icon: "folder" },
  { label: "التنبيهات", icon: "bell" },
  { label: "فريق العمل", icon: "users" },
  { label: "التقارير", icon: "chart" },
  { label: "الاستيراد من Excel", icon: "upload" },
];

const ROLES: { who: string; line: string; tone: "owner" | "employee" | "portal"; items: { label: string; icon: IconName; off?: boolean }[]; note: string }[] = [
  {
    who: "صاحب الحساب",
    line: "يرى المكتب كاملًا",
    tone: "owner",
    items: [
      { label: "الرئيسية", icon: "home" },
      { label: "العقارات", icon: "building" },
      { label: "التحصيل", icon: "coins" },
      { label: "سندات القبض", icon: "wallet" },
      { label: "كشوف حساب الملاك", icon: "bank" },
      { label: "فريق العمل", icon: "shield" },
      { label: "الإعدادات", icon: "settings" },
    ],
    note: "يضيف موظفيه ويحدد لكل منهم ما يراه، ويعتمد ما يتجاوز حدود الاعتماد.",
  },
  {
    who: "الموظف",
    line: "يرى عمله فقط",
    tone: "employee",
    items: [
      { label: "الرئيسية", icon: "home" },
      { label: "العقارات", icon: "building" },
      { label: "التحصيل", icon: "coins" },
      { label: "سندات القبض", icon: "wallet" },
      { label: "كشوف حساب الملاك", icon: "bank", off: true },
      { label: "فريق العمل", icon: "shield", off: true },
      { label: "الإعدادات", icon: "settings", off: true },
    ],
    note: "قوالب جاهزة (تحصيل، تأجير، محاسبة، اطلاع فقط) أو صلاحيات تختارها بنفسك، على كل العقارات أو على عقارات محددة.",
  },
  {
    who: "المالك والمستأجر",
    line: "بوابة برقم الجوال",
    tone: "portal",
    items: [
      { label: "عقاراتي", icon: "building" },
      { label: "التحصيل والمتأخرات", icon: "coins" },
      { label: "كشوف الحساب", icon: "bank" },
      { label: "عقدي ودفعاتي", icon: "file" },
    ],
    note: "يدخلان بالرقم الذي سجّله المكتب، فيريان ما يخصهما فقط دون مكالمات ولا كلمات مرور.",
  },
];

const STATS: { n: string; suffix?: string; label: string; body: string; icon: IconName }[] = [
  { n: "3", label: "بوابات في منصة واحدة", body: "المكتب، والمالك، والمستأجر؛ كلٌّ يدخل برقم جواله ويرى ما يخصه فقط.", icon: "door" },
  { n: "90", label: "يومًا قبل انتهاء العقد", body: "تنبيهات التجديد تبدأ قبل تسعين يومًا، ثم ستين، ثم ثلاثين؛ فلا يفاجئك عقد ينتهي.", icon: "clock" },
  { n: "0", label: "كلمات مرور", body: "الدخول برقم الجوال ورمز لمرة واحدة يصل برسالة نصية، لكل مستخدم ولكل بوابة.", icon: "key" },
];

const STEPS = [
  { title: "اطلب حسابًا", body: "اسمك واسم المكتب ورقم جوالك في النموذج، ونتواصل معك خلال يوم عمل." },
  { title: "نفعّل مكتبك", body: "مكالمة قصيرة لفهم طريقة عملكم، ثم يُفتح المكتب على رقمك." },
  { title: "انقل بياناتك", body: "استورد العقارات والمستأجرين والعقود من ملفات Excel بدل الإدخال اليدوي." },
  { title: "أضف فريقك", body: "ادخل برقمك، وأضف موظفيك وحدد لكل منهم ما يراه، ثم ابدأ يومك." },
];

/** A working day as four real screens. */
const DAY = [
  { when: "صباحًا", title: "لوحة اليوم", body: "ما يحتاج انتباهك اليوم: الوعود والمتابعات والعقود المنتهية والمصروفات المنتظرة، في شاشة واحدة قبل أول مكالمة.", shot: "dashboard" },
  { when: "قبل الظهر", title: "التحصيل حسب العقار", body: "المتأخر لكل عقار، الأهم أولًا، مع مهلة السداد النظامية وتذكيرات جاهزة تُرسل بعد مراجعتك.", shot: "collections" },
  { when: "بعد الظهر", title: "العقار في صفحة واحدة", body: "وحداته وعقوده ومطالباته ومستنداته، والإشغال والإيجار على مدار السنة؛ كل ما يُسأل عنه المالك في مكان واحد.", shot: "properties" },
  { when: "آخر الشهر", title: "كشف المالك", body: "الإيراد والأتعاب والمصروفات وصافي المستحق، يُعتمد ثم يصل المالك في بوابته دون ملفات ولا رسائل.", shot: "statement" },
];

const SAFETY = [
  "عزل كامل بين المكاتب: كل استعلام وكل إجراء مقيّد بمكتبك وبنطاق صلاحيات من يقوم به.",
  "سجل تدقيق لا يُحذف: كل تعديل مسجل باسم صاحبه ووقته وجهازه، مع القيمة قبل التعديل وبعده.",
  "جلسات موقّعة قابلة للإلغاء من الإعدادات، مع تتبع الجهاز وعنوان الاتصال لكل جلسة.",
  "نسخ احتياطي يومي تلقائي لقاعدة البيانات.",
];

const CAPABILITIES: { icon: IconName; title: string; body: string }[] = [
  { icon: "building", title: "العقارات والوحدات", body: "كل عقار بوحداته وملاكه ومستنداته، وحالة كل وحدة لحظة بلحظة." },
  { icon: "file", title: "العقود وجدول الدفعات", body: "عقد يولّد دفعاته، وتنبيه قبل الانتهاء بوقت كافٍ للتجديد أو الإخلاء." },
  { icon: "coins", title: "التحصيل حسب العقار", body: "المستحق والمتأخر لكل عقار، مع مهلة السداد النظامية وطلب التنفيذ عبر ناجز." },
  { icon: "wallet", title: "سندات القبض", body: "سند لكل مبلغ يتوزع على الدفعات المستحقة، حتى الجزئية منها." },
  { icon: "bank", title: "كشوف حساب الملاك", body: "الإيراد والمصروف والأتعاب وصافي المستحق، ولا يُدفع مبلغ مرتين." },
  { icon: "receipt", title: "المصروفات والاعتماد", body: "مصروف بمرفقه يمر على من يعتمده، ويظهر في كشف المالك تلقائيًا." },
  { icon: "shield", title: "فريق وصلاحيات", body: "صاحب حساب وموظفون، لكل موظف أقسامه وعقاراته، وكل تعديل مسجل باسم صاحبه." },
  { icon: "upload", title: "الاستيراد من Excel", body: "انقل عقاراتك ومستأجريك وعقودك من ملفاتك بدل الإدخال اليدوي." },
];

const FAQ = [
  {
    q: "ما هي دارك؟",
    a: "منصة لإدارة وتشغيل الأملاك العقارية للمكاتب وملاك العقار في السعودية: العقارات والوحدات والعقود والتحصيل وسندات القبض وكشوف حساب الملاك والمصروفات في سجل واحد، مع بوابة للمالك وأخرى للمستأجر.",
  },
  {
    q: "كيف يتم الدخول؟",
    a: "برقم الجوال فقط. يصل رمز من ستة أرقام برسالة نصية، ولا توجد كلمات مرور. الأرقام التي يسجّلها المكتب هي وحدها التي تستطيع الدخول.",
  },
  {
    q: "هل يرى الموظف كل شيء؟",
    a: "لا. صاحب الحساب يرى المكتب كاملًا، ويحدد لكل موظف أقسامه وعقاراته: قوالب جاهزة (تحصيل، تأجير، محاسبة، اطلاع فقط) أو صلاحيات يختارها بنفسه. وكل تعديل يُسجَّل باسم صاحبه.",
  },
  {
    q: "هل أستطيع نقل بياناتي الحالية؟",
    a: "نعم. استورد العقارات والمستأجرين والعقود من ملفات Excel عبر معالج الاستيراد، بقالب جاهز للتنزيل يوضح الأعمدة المطلوبة.",
  },
  {
    q: "ماذا يرى المالك والمستأجر؟",
    a: "يدخل كلٌّ منهما برقم جواله المسجّل لدى المكتب: المالك يرى عقاراته وتحصيله وكشوف حسابه، والمستأجر يرى عقده ودفعاته؛ دون مكالمات ولا كلمات مرور.",
  },
  {
    q: "كيف أبدأ؟",
    a: "اطلب حسابًا من النموذج أدناه. نفتح الحسابات بأنفسنا بعد مكالمة قصيرة، عادةً خلال يوم عمل، ونرافقك حتى أول كشف حساب.",
  },
];

function Frame({ shot, title, lazy = false }: { shot: string; title: string; lazy?: boolean }) {
  return (
    <figure className="lp-frame">
      <div className="lp-frame-bar" aria-hidden>
        <i />
        <i />
        <i />
        <span>{title} · دارك</span>
      </div>
      <div className="lp-frame-shot">
        <img src={`/screenshots/${shot}.webp`} alt={`${title} — شاشة من دارك`} width={1366} height={768} loading={lazy ? "lazy" : "eager"} decoding="async" />
      </div>
    </figure>
  );
}

export function Landing() {
  const support = supportContact();
  const year = new Date().getFullYear();
  return (
    <div className={`lp ${thmanyahSans.variable} ${thmanyahDisplay.variable}`}>
      <Reveal />
      <noscript>
        <style>{`.lp .reveal{opacity:1;transform:none}`}</style>
      </noscript>

      <header className="lp-nav">
        <div className="lp-nav-in">
          <Link href="/" className="lp-brand" aria-label="دارك — الصفحة الرئيسية">
            <LogoMark size={34} />
            <b>دارك</b>
          </Link>
          <nav className="lp-links" aria-label="أقسام الصفحة">
            <a href="#roles">الأدوار</a>
            <a href="#day">يومك في دارك</a>
            <a href="#features">ما يغطيه</a>
            <a href="#faq">الأسئلة الشائعة</a>
          </nav>
          <div className="lp-nav-cta">
            <Link href="/login" className="lp-btn lp-btn-outline lp-btn-sm">
              تسجيل الدخول
            </Link>
            <a href="#request" className="lp-btn lp-btn-ink lp-btn-sm lp-hide-sm">
              اطلب حسابًا
            </a>
          </div>
        </div>
      </header>

      <section className="lp-hero">
        <div className="lp-hero-bg" aria-hidden />
        <span className="lp-hero-ring" aria-hidden />
        <div className="lp-wrap">
          <div className="lp-hero-copy">
            <span className="lp-badge lp-up">
              <LogoMark size={14} /> للمكاتب العقارية وملاك العقار في السعودية
            </span>
            <h1 className="lp-up lp-d1">
              إدارة أملاكك.
              <br />
              بصورة أوضح.
            </h1>
            <p className="lp-up lp-d2">العقارات والعقود والتحصيل وسندات القبض وكشوف الملاك في سجل واحد. صاحب الحساب يرى كل شيء، وكل موظف يرى عمله فقط، وللمالك والمستأجر بوابة برقم الجوال.</p>
            <div className="lp-cta lp-up lp-d2">
              <a href="#request" className="lp-btn lp-btn-sand">
                اطلب حسابًا لمكتبك
              </a>
              <Link href="/login" className="lp-btn lp-btn-outline">
                لديك حساب؟ ادخل برقم جوالك
              </Link>
            </div>
          </div>
          <div className="lp-hero-art lp-up lp-d3">
            <Frame shot="dashboard" title="لوحة اليوم" />
            <figure className="lp-phone" aria-hidden>
              <img src="/screenshots/dashboard-m.webp" alt="" width={390} height={720} />
            </figure>
          </div>
        </div>
      </section>

      <section className="lp-strip" aria-labelledby="modules-h">
        <div className="lp-wrap lp-center reveal">
          <p className="lp-eyebrow">المنصة</p>
          <h2 id="modules-h" className="lp-h2" style={{ fontSize: "clamp(24px, 3vw, 32px)" }}>
            كل ما يحتاجه المكتب العقاري، في نظام واحد
          </h2>
        </div>
        <div className="lp-marquee" aria-hidden>
          <div className="lp-marquee-track">
            {[...MODULES, ...MODULES].map((m, i) => (
              <span key={`${m.label}-${i}`} className="lp-marquee-item">
                <span className="lp-marquee-ico">
                  <Icon name={m.icon} size={18} />
                </span>
                {m.label}
              </span>
            ))}
          </div>
        </div>
      </section>

      <section id="roles" className="lp-section">
        <div className="lp-wrap">
          <div className="lp-center reveal">
            <p className="lp-eyebrow">الأدوار</p>
            <h2 className="lp-h2">كل شخص يرى عمله فقط</h2>
            <p className="lp-sub">عند الدخول تظهر القائمة بحسب الدور: صاحب الحساب يرى المكتب كاملًا، والموظف يرى الأقسام التي منحها له، والمالك والمستأجر يدخلان بوابتهما.</p>
          </div>
          <div className="lp-roles">
            {ROLES.map((r, i) => (
              <article key={r.who} className={`lp-card lp-role ${r.tone} reveal`} style={{ transitionDelay: `${i * 90}ms` }}>
                <header>
                  <h3>{r.who}</h3>
                  <span>{r.line}</span>
                </header>
                <ul className="lp-mini" aria-label={`قائمة ${r.who}`}>
                  {r.items.map((it, k) => (
                    <li key={it.label} className={`${it.off ? "off" : ""} ${k === 0 ? "on" : ""}`}>
                      <Icon name={it.icon} size={16} />
                      {it.label}
                      {it.off && <span className="sr-only"> (غير متاح)</span>}
                    </li>
                  ))}
                </ul>
                <p>{r.note}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="lp-section" style={{ paddingTop: 0 }} aria-labelledby="stats-h">
        <div className="lp-wrap">
          <h2 id="stats-h" className="lp-h2 lp-h2-xl reveal">
            دارك بالأرقام
          </h2>
          <div className="lp-stats">
            {STATS.map((s, i) => (
              <div key={s.label} className="lp-stat reveal" style={{ transitionDelay: `${i * 90}ms` }}>
                <span className="lp-stat-ico">
                  <Icon name={s.icon} size={26} />
                </span>
                <div>
                  <span className="lp-stat-n">
                    {s.n}
                    {s.suffix && <small>{s.suffix}</small>}
                  </span>
                  <span className="lp-stat-l">{s.label}</span>
                  <p>{s.body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="start" className="lp-section lp-band">
        <div className="lp-wrap">
          <div className="lp-center reveal">
            <p className="lp-eyebrow">كيف تبدأ</p>
            <h2 className="lp-h2">من الطلب إلى أول كشف حساب في أربع خطوات</h2>
          </div>
          <ol className="lp-steps" style={{ listStyle: "none", margin: "56px 0 0", padding: 0 }}>
            {STEPS.map((s, i) => (
              <li key={s.title} className="lp-step reveal" style={{ transitionDelay: `${i * 90}ms` }}>
                <div className="lp-step-n" aria-hidden>
                  <b>0{i + 1}</b>
                  <i />
                </div>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section id="day" className="lp-section">
        <div className="lp-wrap">
          <div className="lp-center reveal">
            <p className="lp-eyebrow">يومك في دارك</p>
            <h2 className="lp-h2">من أول نظرة في الصباح إلى كشف المالك آخر الشهر</h2>
            <p className="lp-sub">شاشات حقيقية من المنصة، كما يراها المكتب كل يوم.</p>
          </div>
          <div className="lp-rows">
            {DAY.map((d, i) => (
              <div key={d.shot} className={`lp-row reveal ${i % 2 === 1 ? "flip" : ""}`}>
                <div className="lp-row-copy">
                  <span className="lp-when">
                    <Icon name="clock" size={13} /> {d.when}
                  </span>
                  <h3 className="lp-h3">{d.title}</h3>
                  <p>{d.body}</p>
                </div>
                <Frame shot={d.shot} title={d.title} lazy />
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="lp-safe" aria-labelledby="safe-h">
        <span className="najdi lp-roof lp-roof-top" aria-hidden />
        <div className="lp-safe-deco" aria-hidden>
          <span className="lp-safe-ring" />
          <span className="lp-safe-glow" />
        </div>
        <div className="lp-wrap lp-safe-in">
          <div className="reveal">
            <p className="lp-eyebrow">الأمان</p>
            <h2 id="safe-h" style={{ marginTop: 12 }}>
              بياناتك في أمان
            </h2>
            <p className="lp-sub" style={{ color: "var(--dk-on-dark-2)" }}>
              نظام تشغيل مالي لا يسمح بتعديل غير مسجل ولا باطلاع خارج الصلاحية.
            </p>
          </div>
          <ul className="lp-safe-list">
            {SAFETY.map((t, i) => (
              <li key={t} className="reveal" style={{ transitionDelay: `${i * 80}ms` }}>
                {t}
              </li>
            ))}
          </ul>
        </div>
        <span className="najdi lp-roof lp-roof-bottom" aria-hidden />
      </section>

      <section id="features" className="lp-section">
        <div className="lp-wrap">
          <div className="lp-center reveal">
            <p className="lp-eyebrow">ما يغطيه دارك</p>
            <h2 className="lp-h2">كل عقار. كل عقد. كل ريال. كل مهمة.</h2>
          </div>
          <dl className="lp-caps">
            {CAPABILITIES.map((c, i) => (
              <div key={c.title} className="lp-card lp-cap reveal" style={{ transitionDelay: `${(i % 4) * 70}ms` }}>
                <dt>
                  <span className="lp-cap-ico">
                    <Icon name={c.icon} size={20} />
                  </span>
                  {c.title}
                </dt>
                <dd>{c.body}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section id="faq" className="lp-section lp-band">
        <div className="lp-wrap lp-faq-in">
          <div className="lp-center reveal">
            <p className="lp-eyebrow">أسئلة</p>
            <h2 className="lp-h2">الأسئلة الشائعة</h2>
          </div>
          <div className="lp-faq-list">
            {FAQ.map((f, i) => (
              <details key={f.q} className="lp-q reveal" style={{ transitionDelay: `${i * 60}ms` }}>
                <summary>
                  {f.q}
                  <span className="lp-q-plus" aria-hidden>
                    +
                  </span>
                </summary>
                <p>{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section id="request" className="lp-section">
        <div className="lp-wrap">
          <div className="lp-card lp-request-card reveal">
            <div>
              <p className="lp-eyebrow">اطلب حسابًا</p>
              <h2 className="lp-h2">اطلب حسابًا لمكتبك</h2>
              <p className="lp-sub">نفتح الحسابات بأنفسنا لنضمن أن كل مكتب يبدأ بشكل صحيح، ونرافقك حتى أول كشف حساب. نتواصل معك خلال يوم عمل.</p>
              {(support.whatsapp || support.email) && (
                <p className="lp-contact">
                  أو تواصل مباشرة:{" "}
                  {support.whatsapp && (
                    <a href={support.whatsapp} target="_blank" rel="noreferrer">
                      واتساب <span className="num">{support.phoneDisplay}</span>
                    </a>
                  )}
                  {support.whatsapp && support.email && " · "}
                  {support.email && (
                    <a href={`mailto:${support.email}`} className="latin">
                      {support.email}
                    </a>
                  )}
                </p>
              )}
              <p className="lp-request-login">
                لديك حساب بالفعل؟ <Link href="/login">ادخل برقم جوالك</Link>
              </p>
            </div>
            <RequestForm cities={CITIES} />
          </div>
        </div>
      </section>

      <footer className="lp-footer">
        <span className="najdi lp-roof lp-roof-top" aria-hidden />
        <div className="lp-wrap">
          <div className="lp-footer-top">
            <div className="lp-footer-brand">
              <span className="lp-brand">
                <LogoMark size={28} inverse />
                <b>دارك</b>
              </span>
              <p>منصة إدارة وتشغيل الأملاك العقارية للمكاتب وملاك العقار في السعودية.</p>
            </div>
            <nav className="lp-footer-cols" aria-label="روابط">
              <div className="lp-footer-col">
                <b>الصفحة</b>
                <a href="#roles">الأدوار</a>
                <a href="#day">يومك في دارك</a>
                <a href="#features">ما يغطيه</a>
                <a href="#faq">الأسئلة الشائعة</a>
              </div>
              <div className="lp-footer-col">
                <b>الحساب</b>
                <Link href="/login">تسجيل الدخول</Link>
                <a href="#request">اطلب حسابًا</a>
              </div>
              <div className="lp-footer-col">
                <b>قانوني</b>
                <Link href="/privacy">سياسة الخصوصية</Link>
                <Link href="/terms">شروط الاستخدام</Link>
              </div>
            </nav>
          </div>
          <div className="lp-footer-bottom">
            <span>
              © <span className="num">{year}</span> دارك. جميع الحقوق محفوظة.
            </span>
            <span className="lp-tagline">كل دار تحت السيطرة.</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
