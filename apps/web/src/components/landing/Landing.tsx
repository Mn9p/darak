import Link from "next/link";
import { LogoMark } from "@/components/Logo";
import { Icon, type IconName } from "@/components/icons";
import { Ledger } from "./Ledger";
import { RequestForm } from "./RequestForm";
import { CITIES } from "@/lib/constants";
import { supportContact } from "@/lib/support";

/**
 * Public landing page. RTL, one orchestrated animation in the hero (the collection ledger),
 * everything else calm and static. Sign-in is one tap away everywhere.
 */

const SERVICES: { icon: IconName; title: string; body: string }[] = [
  { icon: "building", title: "سجل العقارات والوحدات", body: "كل عقار بوحداته وملاكه ومستنداته في صفحة واحدة، مع حالة كل وحدة لحظة بلحظة." },
  { icon: "file", title: "العقود وجدول الدفعات", body: "عقد إيجار يولّد دفعاته تلقائيًا، ويُنبّه قبل الانتهاء بوقت كافٍ للتجديد أو الإخلاء." },
  { icon: "coins", title: "التحصيل حسب العقار", body: "المستحق والمتأخر لكل عقار، مع مهلة السداد النظامية وتذكيرات جاهزة للإرسال بعد موافقتك." },
  { icon: "wallet", title: "سندات القبض وكشوف الملاك", body: "سند قبض لكل مبلغ، ثم كشف حساب للمالك يوضح الإيراد والمصروف والأتعاب وصافي المستحق." },
  { icon: "receipt", title: "المصروفات والموافقات", body: "مصروف يُسجَّل بمرفقه ويمر على من يعتمده، فيظهر في كشف المالك دون إعادة إدخال." },
  { icon: "users", title: "بوابة المالك والمستأجر", body: "المالك يرى عقاراته وكشوفه، والمستأجر يرى عقده ودفعاته. كلاهما يدخل برقم جواله." },
];

const STEPS = [
  { n: "١", title: "اطلب حسابًا", body: "اسمك واسم المكتب ورقم جوالك في النموذج أدناه." },
  { n: "٢", title: "نتصل بك ونفعّل مكتبك", body: "مكالمة قصيرة نفهم فيها حجم أملاكك، ثم يُفتح المكتب على رقم جوالك خلال يوم عمل." },
  { n: "٣", title: "ادخل برقم جوالك", body: "رمز يصلك برسالة نصية. لا بريد ولا كلمة مرور، ودليل البداية ينتظرك داخل المنصة." },
];

export function Landing() {
  const support = supportContact();
  return (
    <div className="landing">
      <header className="landing-nav">
        <div className="landing-wrap landing-nav-in">
          <Link href="/" className="landing-brand" aria-label="دارك — الصفحة الرئيسية">
            <LogoMark size={34} inverse />
            <b>دارك</b>
          </Link>
          <nav className="landing-links">
            <a href="#services">الخدمات</a>
            <a href="#portals">البوابات</a>
            <a href="#start">كيف تبدأ</a>
          </nav>
          <Link href="/login" className="btn btn-on-dark btn-sm landing-login">
            تسجيل الدخول
          </Link>
        </div>
      </header>

      <section className="landing-hero">
        <div className="landing-wrap landing-hero-in">
          <div className="landing-hero-copy">
            <h1 className="landing-h1">
              <span className="landing-h1-line">إدارة أملاكك.</span>
              <span className="landing-h1-line">بصورة أوضح.</span>
            </h1>
            <p className="landing-lead">منصة للمكاتب العقارية في السعودية: العقارات والعقود والتحصيل وكشوف الملاك في سجل واحد، وبوابة لكل مالك ومستأجر.</p>
            <div className="landing-cta">
              <a href="#request" className="btn btn-accent landing-cta-main">
                اطلب حسابًا لمكتبك
              </a>
              <Link href="/login" className="btn btn-on-dark">
                لديك حساب؟ ادخل برقم جوالك
              </Link>
            </div>
            <p className="landing-note">نفعّل المكاتب بأنفسنا بعد مكالمة قصيرة، ونبقى معك حتى أول كشف حساب.</p>
          </div>
          <div className="landing-hero-art">
            <Ledger />
          </div>
        </div>
      </section>

      <section id="services" className="landing-section">
        <div className="landing-wrap">
          <h2 className="landing-h2">ما الذي تقدمه المنصة</h2>
          <p className="landing-sub">ست خدمات تغطي يوم المكتب العقاري كاملًا، من تسجيل العقار إلى تحويل مستحقات المالك.</p>
          <dl className="landing-services">
            {SERVICES.map((s) => (
              <div key={s.title} className="landing-service">
                <dt>
                  <span className="landing-service-icon">
                    <Icon name={s.icon} size={18} />
                  </span>
                  {s.title}
                </dt>
                <dd>{s.body}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section id="portals" className="landing-section landing-portals">
        <div className="landing-wrap">
          <h2 className="landing-h2">ثلاث بوابات، رقم واحد</h2>
          <p className="landing-sub">الرقم المسجل لدى المكتب هو مفتاح الدخول. المالك والمستأجر يدخلان تلقائيًا بالرقم الذي سجّله مكتبهم، بلا حسابات ولا كلمات مرور.</p>
          <div className="landing-portal-grid">
            <Link href="/login" className="landing-portal">
              <span className="landing-portal-role">المكتب العقاري</span>
              <span className="landing-portal-body">لوحة اليوم، والتحصيل، والعقود المنتهية، والمهام. صلاحيات لكل دور: مدير، محصّل، محاسب، مدقق.</span>
              <span className="landing-portal-go">ادخل إلى مكتبك</span>
            </Link>
            <Link href="/login" className="landing-portal">
              <span className="landing-portal-role">المالك</span>
              <span className="landing-portal-body">عقاراته وعقوده والمتأخرات وكشوف حسابه، جاهزة للطباعة أو الاعتراض عليها.</span>
              <span className="landing-portal-go">ادخل كمالك</span>
            </Link>
            <Link href="/login" className="landing-portal">
              <span className="landing-portal-role">المستأجر</span>
              <span className="landing-portal-body">عقده والدفعات القادمة والمسددة، وسندات القبض، والمستندات.</span>
              <span className="landing-portal-go">ادخل كمستأجر</span>
            </Link>
          </div>
        </div>
      </section>

      <section id="start" className="landing-section">
        <div className="landing-wrap">
          <h2 className="landing-h2">كيف تبدأ</h2>
          <ol className="landing-steps">
            {STEPS.map((s) => (
              <li key={s.n} className="landing-step">
                <span className="landing-step-n">{s.n}</span>
                <span className="landing-step-title">{s.title}</span>
                <span className="landing-step-body">{s.body}</span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section id="request" className="landing-section landing-request">
        <div className="landing-wrap landing-request-in">
          <div className="landing-request-copy">
            <h2 className="landing-h2">اطلب حسابًا لمكتبك</h2>
            <p className="landing-sub">نفتح الحسابات بأنفسنا لنضمن أن كل مكتب يبدأ بشكل صحيح: نتصل بك، نفعّل المكتب على رقمك، ونرافقك في إدخال أول عقار وعقد.</p>
            <ul className="landing-request-points">
              <li>يوم عمل واحد حتى التفعيل</li>
              <li>بلا رسوم إعداد، وبلا التزام في فترة التجربة</li>
              <li>استيراد بياناتك من Excel معك في الجلسة الأولى</li>
            </ul>
            {(support.whatsapp || support.email) && (
              <p className="landing-request-contact">
                أو تواصل مباشرة:{" "}
                {support.whatsapp && (
                  <a href={support.whatsapp} target="_blank" rel="noreferrer" className="landing-contact-link">
                    واتساب <span className="num">{support.phoneDisplay}</span>
                  </a>
                )}
                {support.whatsapp && support.email && " · "}
                {support.email && (
                  <a href={`mailto:${support.email}`} className="landing-contact-link latin">
                    {support.email}
                  </a>
                )}
              </p>
            )}
          </div>
          <div className="landing-request-card">
            <RequestForm cities={CITIES} />
          </div>
        </div>
      </section>

      <footer className="landing-footer">
        <div className="landing-wrap landing-footer-in">
          <span className="landing-brand landing-brand-sm">
            <LogoMark size={26} inverse />
            <b>دارك</b>
          </span>
          <nav className="landing-footer-links">
            <Link href="/privacy">سياسة الخصوصية</Link>
            <Link href="/terms">شروط الاستخدام</Link>
            <a href="#request">اطلب حسابًا</a>
            <Link href="/login">تسجيل الدخول</Link>
          </nav>
          <span className="landing-copy">
            © <span className="num">{new Date().getFullYear()}</span> دارك. كل دار تحت السيطرة.
          </span>
        </div>
      </footer>
    </div>
  );
}
