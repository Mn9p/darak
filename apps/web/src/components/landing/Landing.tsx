import Link from "next/link";
import { LogoMark } from "@/components/Logo";
import { Icon, type IconName } from "@/components/icons";
import { RequestForm } from "./RequestForm";
import { DayTour } from "./DayTour";
import { CITIES } from "@/lib/constants";
import { supportContact } from "@/lib/support";

/**
 * Public landing page, built on the brand file: ink hero with the brand ring and our Najdi roofline, a "who sees what"
 * section that shows the owner/employee model, an interactive day in the product, the capability list and the
 * request-an-account form. Screenshots: /public/screenshots (desktop *.webp, phone *-m.webp).
 */

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

const START = [
  { title: "اطلب حسابًا", body: "اسمك واسم المكتب ورقم جوالك في النموذج." },
  { title: "نفعّل مكتبك", body: "مكالمة قصيرة، ثم يُفتح المكتب على رقمك خلال يوم عمل." },
  { title: "أضف فريقك", body: "ادخل برقمك، وأضف موظفيك وحدد لكل منهم ما يراه." },
];

export function Landing() {
  const support = supportContact();
  return (
    <div className="lp">
      <header className="lp-nav">
        <div className="lp-wrap lp-nav-in">
          <Link href="/" className="lp-brand" aria-label="دارك — الصفحة الرئيسية">
            <LogoMark size={34} inverse />
            <b>دارك</b>
          </Link>
          <nav className="lp-links" aria-label="أقسام الصفحة">
            <a href="#roles">الأدوار</a>
            <a href="#day">يومك في دارك</a>
            <a href="#features">ما يغطيه</a>
          </nav>
          <div className="lp-nav-cta">
            <Link href="/login" className="btn btn-on-dark btn-sm">
              تسجيل الدخول
            </Link>
            <a href="#request" className="btn btn-accent btn-sm lp-hide-sm">
              اطلب حسابًا
            </a>
          </div>
        </div>
      </header>

      <section className="lp-hero">
        <div className="lp-wrap lp-hero-in">
          <div className="lp-hero-copy">
            <span className="lp-kicker">
              <LogoMark size={16} inverse /> للمكاتب العقارية وملاك العقار في السعودية
            </span>
            <h1>
              إدارة أملاكك.
              <br />
              بصورة أوضح.
            </h1>
            <p>العقارات والعقود والتحصيل وسندات القبض وكشوف الملاك في سجل واحد. صاحب الحساب يرى كل شيء، وكل موظف يرى عمله فقط، وللمالك والمستأجر بوابة برقم الجوال.</p>
            <div className="lp-cta">
              <a href="#request" className="btn btn-accent lp-cta-main">
                اطلب حسابًا لمكتبك
              </a>
              <Link href="/login" className="btn btn-on-dark lp-cta-main">
                لديك حساب؟ ادخل برقم جوالك
              </Link>
            </div>
          </div>
          <div className="lp-hero-art" aria-hidden>
            <figure className="lp-desk">
              <img src="/screenshots/dashboard.webp" alt="" width={1366} height={768} />
            </figure>
            <figure className="lp-phone">
              <img src="/screenshots/dashboard-m.webp" alt="" width={390} height={720} />
            </figure>
          </div>
        </div>
        <span className="najdi lp-roofline" aria-hidden />
      </section>

      <section id="roles" className="lp-section">
        <div className="lp-wrap">
          <h2 className="lp-h2">كل شخص يرى عمله فقط</h2>
          <p className="lp-sub">عند الدخول تظهر القائمة بحسب الدور: صاحب الحساب يرى المكتب كاملًا، والموظف يرى الأقسام التي منحها له، والمالك والمستأجر يدخلان بوابتهما.</p>
          <div className="lp-roles">
            {ROLES.map((r) => (
              <article key={r.who} className={`lp-role ${r.tone}`}>
                <header>
                  <h3>{r.who}</h3>
                  <span>{r.line}</span>
                </header>
                <ul className="lp-mini" aria-label={`قائمة ${r.who}`}>
                  {r.items.map((it, i) => (
                    <li key={it.label} className={`${it.off ? "off" : ""} ${i === 0 ? "on" : ""}`}>
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

      <section id="day" className="lp-section lp-day">
        <div className="lp-wrap">
          <h2 className="lp-h2">يومك في دارك</h2>
          <p className="lp-sub">من أول نظرة في الصباح إلى كشف المالك آخر الشهر. شاشات حقيقية من المنصة، على الجوال والحاسب.</p>
          <DayTour />
        </div>
      </section>

      <section id="features" className="lp-section">
        <div className="lp-wrap">
          <h2 className="lp-h2">ما يغطيه دارك</h2>
          <dl className="lp-caps">
            {CAPABILITIES.map((c) => (
              <div key={c.title}>
                <dt>
                  <span className="lp-cap-ico">
                    <Icon name={c.icon} size={18} />
                  </span>
                  {c.title}
                </dt>
                <dd>{c.body}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section id="request" className="lp-section lp-request">
        <div className="lp-wrap lp-request-in">
          <div>
            <h2 className="lp-h2">اطلب حسابًا لمكتبك</h2>
            <p className="lp-sub">نفتح الحسابات بأنفسنا لنضمن أن كل مكتب يبدأ بشكل صحيح، ونرافقك حتى أول كشف حساب.</p>
            <ol className="lp-start">
              {START.map((s, i) => (
                <li key={s.title}>
                  <span className="num">{i + 1}</span>
                  <div>
                    <b>{s.title}</b>
                    <p>{s.body}</p>
                  </div>
                </li>
              ))}
            </ol>
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
          </div>
          <div className="lp-form">
            <RequestForm cities={CITIES} />
          </div>
        </div>
      </section>

      <footer className="lp-footer">
        <span className="najdi lp-footer-roof" aria-hidden />
        <div className="lp-wrap lp-footer-in">
          <span className="lp-brand lp-brand-sm">
            <LogoMark size={26} inverse />
            <b>دارك</b>
          </span>
          <nav className="lp-footer-links" aria-label="روابط">
            <Link href="/privacy">سياسة الخصوصية</Link>
            <Link href="/terms">شروط الاستخدام</Link>
            <Link href="/login">تسجيل الدخول</Link>
          </nav>
          <span className="lp-copy">
            © <span className="num">{new Date().getFullYear()}</span> دارك. كل دار تحت السيطرة.
          </span>
        </div>
      </footer>
    </div>
  );
}
