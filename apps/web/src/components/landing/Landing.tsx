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
  { label: "المساعد الذكي", icon: "sparkle" },
];

const ROLES: { who: string; line: string; tone: "owner" | "employee" | "portal"; items: { label: string; icon: IconName; off?: boolean }[]; note: string }[] = [
  {
    who: "صاحب الحساب",
    line: "يشوف المكتب كله",
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
    note: "يضيف موظفينه ويحدد وش يشوف كل واحد منهم، ويعتمد اللي يتعدى حدود الاعتماد.",
  },
  {
    who: "الموظف",
    line: "يشوف شغله بس",
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
    note: "قوالب جاهزة (تحصيل، تأجير، محاسبة، اطلاع فقط) أو صلاحيات تختارها أنت، على كل العقارات أو على عقارات معيّنة.",
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
    note: "يدخلون بالرقم اللي سجّله المكتب، ويشوفون اللي يخصهم بس، بلا مكالمات ولا كلمات مرور.",
  },
];

const STATS: { n: string; suffix?: string; label: string; body: string; icon: IconName }[] = [
  { n: "3", label: "بوابات في منصة وحدة", body: "المكتب والمالك والمستأجر؛ كل واحد يدخل برقم جواله ويشوف اللي يخصه بس.", icon: "door" },
  { n: "90", label: "يوم قبل نهاية العقد", body: "تنبيهات التجديد تبدأ قبل تسعين يوم، وبعدها ستين، وبعدها ثلاثين؛ فما يفاجئك عقد ينتهي.", icon: "clock" },
  { n: "0", label: "كلمات مرور", body: "تدخل برقم جوالك ورمز لمرة وحدة يوصلك برسالة نصية، لكل مستخدم ولكل بوابة.", icon: "key" },
];

const STEPS = [
  { title: "اطلب حسابك", body: "اكتب اسمك واسم المكتب ورقم جوالك في النموذج، ونكلمك خلال يوم عمل." },
  { title: "نفعّل مكتبك", body: "مكالمة قصيرة نفهم فيها طريقة شغلكم، وبعدها نفتح المكتب على رقمك." },
  { title: "انقل بياناتك", body: "استورد العقارات والمستأجرين والعقود من ملفات Excel، بدل ما تدخلها وحدة وحدة." },
  { title: "أضف فريقك", body: "ادخل برقمك، وأضف موظفينك وحدد وش يشوف كل واحد، وابدأ يومك." },
];

/** A working day as four real screens. */
const DAY = [
  { when: "صباحًا", title: "لوحة اليوم", body: "اللي يبي منك انتباه اليوم: الوعود والمتابعات والعقود المنتهية والمصروفات اللي تنتظر، كلها في شاشة وحدة قبل أول مكالمة.", shot: "dashboard" },
  { when: "قبل الظهر", title: "التحصيل حسب العقار", body: "المتأخر في كل عقار، الأهم أول، مع مهلة السداد النظامية وتذكيرات جاهزة ما تنرسل إلا بعد ما تراجعها.", shot: "collections" },
  { when: "بعد الظهر", title: "العقار في صفحة واحدة", body: "وحداته وعقوده ومطالباته ومستنداته، والإشغال والإيجار على مدار السنة؛ كل شي يسأل عنه المالك تلقاه في مكان واحد.", shot: "properties" },
  { when: "آخر الشهر", title: "كشف المالك", body: "الإيراد والأتعاب والمصروفات وصافي المستحق، تعتمده ويوصل المالك في بوابته، بلا ملفات ولا رسائل.", shot: "statement" },
];

/** The assistant section's sample answer (illustrative names and figures). */
const AI_ROWS = [
  { tenant: "فهد العتيبي", unit: "عمارة النخيل · شقة 4", amount: "18,500" },
  { tenant: "مؤسسة الريان", unit: "مجمع الياسمين · معرض 2", amount: "12,000" },
  { tenant: "نورة القحطاني", unit: "عمارة النخيل · شقة 9", amount: "7,250" },
];

const SAFETY = [
  "كل مكتب معزول عن غيره تمامًا: أي استعلام أو إجراء محصور في مكتبك وفي صلاحيات اللي سوّاه.",
  "سجل تدقيق ما ينحذف: كل تعديل مسجّل باسم اللي سوّاه ووقته وجهازه، مع القيمة قبل وبعد.",
  "كل جلسة موقّعة ومعروف جهازها وعنوان اتصالها، وتقدر تلغيها من الإعدادات.",
  "نسخة احتياطية يومية تلقائية لقاعدة البيانات.",
];

const CAPABILITIES: { icon: IconName; title: string; body: string }[] = [
  { icon: "building", title: "العقارات والوحدات", body: "كل عقار بوحداته وملاكه ومستنداته، وحالة كل وحدة أول بأول." },
  { icon: "file", title: "العقود وجدول الدفعات", body: "العقد يطلّع دفعاته بنفسه، وينبهك قبل نهايته بوقت يكفي للتجديد أو الإخلاء." },
  { icon: "coins", title: "التحصيل حسب العقار", body: "المستحق والمتأخر لكل عقار، مع مهلة السداد النظامية وطلب التنفيذ عبر ناجز." },
  { icon: "wallet", title: "سندات القبض", body: "سند لكل مبلغ ينوزع على الدفعات المستحقة، حتى لو كانت جزئية." },
  { icon: "bank", title: "كشوف حساب الملاك", body: "الإيراد والمصروف والأتعاب وصافي المستحق، وما ينصرف مبلغ مرتين." },
  { icon: "receipt", title: "المصروفات والاعتماد", body: "كل مصروف بمرفقه يمر على اللي يعتمده، ويطلع في كشف المالك تلقائيًا." },
  { icon: "shield", title: "فريق وصلاحيات", body: "صاحب حساب وموظفين، كل موظف له أقسامه وعقاراته، وكل تعديل مسجّل باسم اللي سوّاه." },
  { icon: "upload", title: "الاستيراد من Excel", body: "انقل عقاراتك ومستأجرينك وعقودك من ملفاتك، بدل ما تدخلها يدوي." },
];

const FAQ = [
  {
    q: "وش هي دارك؟",
    a: "منصة تدير فيها أملاكك العقارية وتشغّلها، للمكاتب وملاك العقار في السعودية: العقارات والوحدات والعقود والتحصيل وسندات القبض وكشوف حساب الملاك والمصروفات، كلها في سجل واحد، ومعها بوابة للمالك وبوابة للمستأجر.",
  },
  {
    q: "كيف أدخل؟",
    a: "برقم الجوال بس. يوصلك رمز من ست أرقام برسالة نصية، وما فيه كلمات مرور. وما يقدر يدخل إلا الأرقام اللي سجّلها المكتب.",
  },
  {
    q: "هل الموظف يشوف كل شي؟",
    a: "لا. صاحب الحساب يشوف المكتب كله، ويحدد لكل موظف أقسامه وعقاراته: قوالب جاهزة (تحصيل، تأجير، محاسبة، اطلاع فقط) أو صلاحيات يختارها هو. وكل تعديل ينسجل باسم اللي سوّاه.",
  },
  {
    q: "أقدر أنقل بياناتي الحالية؟",
    a: "أكيد. استورد العقارات والمستأجرين والعقود من ملفات Excel عن طريق معالج الاستيراد، ومعه قالب جاهز تنزّله يوضح لك الأعمدة المطلوبة.",
  },
  {
    q: "وش يشوف المالك والمستأجر؟",
    a: "كل واحد يدخل برقم جواله المسجّل عند المكتب: المالك يشوف عقاراته وتحصيله وكشوف حسابه، والمستأجر يشوف عقده ودفعاته؛ بلا مكالمات ولا كلمات مرور.",
  },
  {
    q: "أقدر أستخدم دارك من Claude أو ChatGPT أو Gemini؟",
    a: "إيه. كل عضو في المكتب يربط مساعده الذكي برابط واحد (MCP) ويدخل دارك برقم جواله، وبعدها يسأل بالعربي عن العقود والتحصيل والمصروفات والكشوف. المساعد يقرأ بس، وفي حدود صلاحيات العضو نفسه، وما يقدر يعدّل أي شي.",
  },
  {
    q: "كيف أبدأ؟",
    a: "اطلب حسابك من النموذج تحت. نفتح الحسابات بنفسنا بعد مكالمة قصيرة، غالبًا خلال يوم عمل، ونكون معك لين يطلع أول كشف حساب.",
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
            <a href="#ai">المساعد الذكي</a>
            <a href="#features">ما يغطيه</a>
            <a href="#faq">الأسئلة الشائعة</a>
          </nav>
          <div className="lp-nav-cta">
            <Link href="/login" className="lp-btn lp-btn-outline lp-btn-sm">
              تسجيل الدخول
            </Link>
            <a href="#request" className="lp-btn lp-btn-ink lp-btn-sm lp-hide-sm">
              اطلب حسابك
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
              إدارة أملاكك بصورة أوضح.
            </h1>
            <p className="lp-up lp-d2">العقارات والعقود والتحصيل وسندات القبض وكشوف الملاك، كلها في سجل واحد. صاحب الحساب يشوف كل شي، وكل موظف يشوف شغله بس، والمالك والمستأجر لهم بوابة يدخلونها برقم الجوال.</p>
            <div className="lp-cta lp-up lp-d2">
              <a href="#request" className="lp-btn lp-btn-sand">
                اطلب حساب لمكتبك
              </a>
              <Link href="/login" className="lp-btn lp-btn-outline">
                عندك حساب؟ ادخل برقم جوالك
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
            كل اللي يحتاجه المكتب العقاري، في نظام واحد
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
            <h2 className="lp-h2">كل واحد يشوف شغله بس</h2>
            <p className="lp-sub">أول ما تدخل تطلع لك القائمة حسب دورك: صاحب الحساب يشوف المكتب كله، والموظف يشوف الأقسام اللي انعطاها، والمالك والمستأجر يدخلون بوابتهم.</p>
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
            <h2 className="lp-h2">من الطلب لين أول كشف حساب، في أربع خطوات</h2>
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
            <h2 className="lp-h2">من أول نظرة الصبح لين كشف المالك آخر الشهر</h2>
            <p className="lp-sub">شاشات حقيقية من المنصة، زي ما يشوفها المكتب كل يوم.</p>
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

      <section id="ai" className="lp-section lp-band" aria-labelledby="ai-h">
        <div className="lp-wrap lp-ai">
          <div className="reveal">
            <p className="lp-eyebrow">المساعد الذكي</p>
            <h2 id="ai-h" className="lp-h2">
              اسأل مساعدك الذكي عن بيانات مكتبك العقاري
            </h2>
            <p className="lp-sub">اربط Claude أو ChatGPT أو Gemini بدارك خلال دقيقة، واسأله بالعربي: مين المتأخرين في السداد، وش العقود اللي بتنتهي، وكم حصّلت هالشهر.</p>
            <ul className="lp-ai-list">
              <li>رابط واحد (MCP) تلصقه في مساعدك، وتدخل دارك برقم جوالك.</li>
              <li>يشوف بس اللي يشوفه العضو نفسه، بنفس صلاحياته وعقاراته.</li>
              <li>يقرأ بس، وما يقدر يعدّل أو يحذف أي شي. وتوقف الربط متى ما بغيت.</li>
            </ul>
            <div className="lp-ai-with">
              يشتغل مع <b className="latin">Claude</b>
              <b className="latin">ChatGPT</b>
              <b className="latin">Gemini</b>
            </div>
          </div>
          <figure className="lp-chat reveal" style={{ margin: 0 }} aria-label="مثال محادثة مع المساعد الذكي">
            <div className="lp-chat-head">
              <b>
                <Icon name="sparkle" size={18} /> مساعدك الذكي
              </b>
              <span className="lp-chat-on">دارك متصل</span>
            </div>
            <div className="lp-chat-body">
              <div className="lp-bubble lp-bubble-me">مين المستأجرين المتأخرين في السداد هالشهر؟</div>
              <div className="lp-tool">
                <Icon name="search" size={14} /> يقرأ من دارك · <code>list_overdue_rent</code>
              </div>
              <div className="lp-bubble lp-bubble-ai">
                عندك ثلاث دفعات متأخرة مجموعها <b className="num">37,750</b> ريال، أكبرها على فهد العتيبي من <span className="num">24</span> يوم:
                <div className="lp-chat-rows">
                  {AI_ROWS.map((r) => (
                    <div key={r.tenant}>
                      <b>{r.tenant}</b>
                      <span>{r.unit}</span>
                      <strong className="num">{r.amount} ر.س</strong>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </figure>
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
              نظام مالي ما يسمح بأي تعديل ما ينسجل، ولا باطلاع برّا الصلاحية.
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
              <p className="lp-eyebrow">اطلب حسابك</p>
              <h2 className="lp-h2">اطلب حساب لمكتبك</h2>
              <p className="lp-sub">نفتح الحسابات بنفسنا عشان نضمن إن كل مكتب يبدأ صح، ونكون معك لين أول كشف حساب. ونكلمك خلال يوم عمل.</p>
              {(support.whatsapp || support.email) && (
                <p className="lp-contact">
                  أو كلّمنا على طول:{" "}
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
                عندك حساب؟ <Link href="/login">ادخل برقم جوالك</Link>
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
                <a href="#ai">المساعد الذكي</a>
                <a href="#features">ما يغطيه</a>
                <a href="#faq">الأسئلة الشائعة</a>
              </div>
              <div className="lp-footer-col">
                <b>الحساب</b>
                <Link href="/login">تسجيل الدخول</Link>
                <a href="#request">اطلب حسابك</a>
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
