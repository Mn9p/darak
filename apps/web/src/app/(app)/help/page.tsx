import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { hrefPermission } from "@/lib/nav";
import { supportContact } from "@/lib/support";
import { db } from "@/lib/db";
import { TASK_PRIORITY, TICKET_STATUS } from "@/lib/constants";
import { datetime, relative } from "@/lib/format";
import { PageHeader, Card, Table, StatusTag, EmptyState, Tabs, Tag, Alert, StatGrid, StatCard } from "@/components/ui";
import { TicketForm } from "./TicketForm";

export const dynamic = "force-dynamic";

const KB: { title: string; icon: string; href: string; items: { q: string; a: string }[] }[] = [
  {
    title: "البدء",
    icon: "",
    href: "/settings",
    items: [
      { q: "ما ترتيب إدخال البيانات الصحيح؟", a: "المالك ← العقار ← الوحدات ← العقد. المستأجر يُنشأ من داخل العقد نفسه، وبيانات المكتب والموظفون في أي وقت. تابع التقدم من قائمة الجاهزية في الإعدادات." },
      { q: "كيف أنقل بياناتي من Excel؟", a: "من مركز الاستيراد نزّل قالب CSV لكل نوع، عبّئه، ثم ارفعه. يتحقق النظام من كل صف قبل الحفظ ويعرض الأخطاء بوضوح دون إهمال أي صف." },
      { q: "من يرى ماذا؟", a: "مدير المكتب يرى كل شيء. مدير العقار يرى العقارات المسندة له فقط. المدقق قراءة فقط. المالك والمستأجر لهما بوابات منفصلة." },
    ],
  },
  {
    title: "العقود",
    icon: "",
    href: "/contracts",
    items: [
      { q: "كيف تُنشأ الدفعات؟", a: "عند تفعيل العقد يولّد النظام جدول السداد تلقائيًا حسب الدورية (شهري، ربع سنوي، نصف سنوي، سنوي) أو عدد دفعات مخصص. العقد المسودة لا جدول له بعد." },
      { q: "ماذا يحدث عند اقتراب انتهاء العقد؟", a: "قبل 90 يومًا يتحول إلى «ينتهي قريبًا» ويُنبَّه الفريق، قبل 60 يومًا تُنشأ مهمة متابعة تجديد، وقبل 30 يومًا يُصعَّد لمدير المكتب إن لم يُتخذ قرار." },
      { q: "هل يمكن حذف عقد؟", a: "لا. العقود لا تُحذف حفاظًا على السجل المالي؛ يمكن إلغاؤها أو إنهاؤها مع توثيق السبب والتسوية النهائية." },
    ],
  },
  {
    title: "التحصيل",
    icon: "",
    href: "/collections",
    items: [
      { q: "متى تُفتح المطالبة؟", a: "تلقائيًا في يوم الاستحقاق وتُسند للمحصل. تبقى «مستحقة» خلال مهلة السداد النظامية (15 يومًا للدفعات الشهرية والربعية، 30 يومًا لنصف السنوية والسنوية)، ثم تصبح «متأخرة» ويُرسل للمستأجر إشعار التأخر." },
      { q: "ما معنى درجة الأولوية؟", a: "درجة من 0 إلى 100 تُحسب من المبلغ المتبقي، أيام التأخر، الوعود المكسورة، ومستوى مخاطر المستأجر — الأعلى يُتابع أولًا." },
      { q: "ما الوعد المكسور؟", a: "عند تسجيل وعد بالسداد بتاريخ محدد ومرور التاريخ دون دفعة، يتحول للحالة «وعد مكسور» ويُنبَّه مدير المكتب." },
    ],
  },
  {
    title: "سندات القبض",
    icon: "",
    href: "/payments",
    items: [
      { q: "كيف أسجل سند قبض؟", a: "من سندات القبض ← تسجيل سند قبض: اختر المستأجر ثم الدفعات المستحقة والمبلغ، ويُخصَّص المبلغ على الدفعات من الأقدم أو حسب اختيارك." },
      { q: "هل يمكن تعديل دفعة معتمدة؟", a: "لا يمكن تعديلها إلا بصلاحية اعتماد المدفوعات، وتُسجل كل التغييرات في سجل العمليات (BR-003)." },
      { q: "ما المطابقة البنكية؟", a: "مقارنة الحركات البنكية المستوردة مع الدفعات المسجلة بالمرجع والمبلغ والتاريخ، مع اقتراحات مطابقة وكشف التكرار." },
    ],
  },
  {
    title: "التسويات",
    icon: "",
    href: "/statements",
    items: [
      { q: "كيف يُحسب صافي المستحق للمالك؟", a: "الإيجار المحصل × نسبة الملكية − نسبة الإدارة − المصروفات المعتمدة على العقار خلال الفترة." },
      { q: "ماذا لو كان للعقار أكثر من مالك؟", a: "تُوزع الإيرادات والمصروفات حسب نسب الملكية المسجلة (مجموعها 100%) مع الاحتفاظ بتاريخ الملكية." },
    ],
  },
  {
    title: "التقارير",
    icon: "",
    href: "/reports",
    items: [
      { q: "ما تقرير أعمار الديون؟", a: "يصنف المتأخرات في شرائح (1–30، 31–60، 61–90، أكثر من 90 يومًا) لكل مستأجر وعقار." },
      { q: "هل يمكن تصدير التقارير؟", a: "نعم بصيغة Excel أو PDF لمن يملك صلاحية التصدير، ويُسجل كل تصدير في سجل العمليات." },
    ],
  },
];

const FAQ = [
  { q: "كيف أدخل إلى حسابي؟", a: "برقم جوالك المسجل لدى المكتب. يصلك رمز من 6 أرقام برسالة نصية، ولا توجد كلمة مرور. لتغيير رقمك افتح «ملفي الشخصي» واضغط «تغيير الرقم»، ويصلك رمز تحقق على الرقم الجديد." },
  { q: "هل بياناتي محفوظة داخل المملكة؟", a: "نعم، تُستضاف البيانات والنسخ الاحتياطية داخل المملكة وفق متطلبات PDPL." },
  { q: "كيف أضيف حقلًا خاصًا بمكتبي؟", a: "من الإعدادات ← الحقول المخصصة، أضف اسم الحقل للعقارات أو الوحدات أو الملاك أو المستأجرين." },
  { q: "لماذا لا أرى بعض العقارات؟", a: "دورك محدد النطاق (مدير عقار) ويرى العقارات المسندة له فقط. اطلب الإسناد من مدير المكتب." },
  { q: "هل يمكن تشغيل أكثر من فرع؟", a: "نعم، من الإعدادات ← الفروع. يمكن ربط الموظفين والعقارات بالفرع." },
];

const QUICK_START: { n: number; title: string; text: string; href: string; label: string }[] = [
  { n: 1, title: "مالك", text: "سجّل المالك ببياناته وحسابه البنكي؛ عليه تُبنى كشوف الحساب لاحقًا.", href: "/owners/new", label: "إضافة مالك" },
  { n: 2, title: "عقار", text: "أضف العقار واربطه بالمالك مع نسبة الملكية ونسبة الإدارة.", href: "/properties/new", label: "إضافة عقار" },
  { n: 3, title: "وحدات", text: "أضف وحدات العقار برقمها ونوعها والإيجار المستهدف.", href: "/units/new", label: "إضافة وحدة" },
  { n: 4, title: "عقد", text: "أنشئ العقد للمستأجر على الوحدة وفعّله؛ المستأجر يُنشأ من داخل العقد.", href: "/contracts/new", label: "إنشاء عقد" },
];

const AUTO_AFTER = [
  "تُنشأ الدفعات المستحقة لكل عقد حسب دورية السداد، دون إدخال يدوي.",
  "تتحدث حالة كل دفعة (قادمة، مستحقة، متأخرة، مسددة) من تاريخ الاستحقاق وسندات القبض.",
  "ما يتجاوز مهلة السداد يتحول إلى مطالبة تحصيل على صفحة العقار.",
  "قبل انتهاء العقد بـ 90 يومًا يصلك تنبيه التجديد، ثم مهمة متابعة قبل 60 يومًا.",
  "كشف حساب المالك يُحسب من التحصيل ناقص نسبة الإدارة والمصروفات المعتمدة.",
];

const TABS = [
  { key: "kb", label: "قاعدة المعرفة" },
  { key: "tickets", label: "تذاكر الدعم" },
];

export default async function HelpPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireStaff();
  const allowed = (href: string) => {
    const p = hrefPermission(href);
    return !p || can(user, p);
  };
  const support = supportContact();
  const sp = await searchParams;
  const tab = sp.tab ?? "kb";
  const org = user.organizationId;
  const [tickets, open] = await Promise.all([
    db.supportTicket.findMany({ where: { organizationId: org }, orderBy: { createdAt: "desc" }, take: 50, include: { user: { select: { name: true } } } }),
    db.supportTicket.count({ where: { organizationId: org, status: { in: ["OPEN", "IN_PROGRESS"] } } }),
  ]);

  return (
    <>
      <PageHeader eyebrow="الدعم" title="مركز المساعدة" subtitle="أدلة سريعة، إجابات على الأسئلة الشائعة، وتواصل مباشر مع فريق دارك." />

      <Tabs tabs={[TABS[0], { ...TABS[1], count: open }]} active={tab} base="/help" />

      {tab === "kb" && (
        <div className="space-y-4">
          <Card tone="warm" title="دليل البداية في 5 دقائق" subtitle="أربع خطوات بالترتيب، وبعدها يعمل النظام عنك.">
            <div className="grid gap-5 lg:grid-cols-5">
              <ol className="grid gap-3 sm:grid-cols-2 lg:col-span-3">
                {QUICK_START.map((s) => (
                  <li key={s.n} className="flex items-start gap-3 rounded-xl bg-white/70 p-3">
                    <span className="num grid h-7 w-7 flex-none place-items-center rounded-full bg-sand text-[13px] font-bold text-ink" aria-hidden>
                      {s.n}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[14px] font-bold text-text">{s.title}</span>
                      <span className="mt-0.5 block text-[13px] leading-relaxed text-text-2">{s.text}</span>
                      {allowed(s.href) && (
                        <Link href={s.href} className="btn btn-link btn-xs mt-1 !px-0">
                          {s.label}
                        </Link>
                      )}
                    </span>
                  </li>
                ))}
              </ol>
              <div className="lg:col-span-2">
                <div className="eyebrow-ar mb-2">ما يحدث تلقائيًا بعدها</div>
                <ul className="space-y-2">
                  {AUTO_AFTER.map((t) => (
                    <li key={t} className="flex items-start gap-2 text-[13px] leading-relaxed text-text-2">
                      <span className="mt-[7px] h-1.5 w-1.5 flex-none rounded-full bg-brand" aria-hidden />
                      <span>{t}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </Card>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {KB.map((s) => (
              <Card
                key={s.title}
                title={
                  <span className="flex items-center gap-2">
                    <span>{s.icon}</span> {s.title}
                  </span>
                }
                actions={
                  allowed(s.href) ? (
                    <Link href={s.href} className="btn btn-link btn-xs">
                      فتح القسم
                    </Link>
                  ) : undefined
                }
              >
                <div className="space-y-1">
                  {s.items.map((it) => (
                    <details key={it.q} className="rounded-lg px-2 py-1.5 hover:bg-mist">
                      <summary className="text-[13.5px] font-semibold text-text">{it.q}</summary>
                      <p className="mt-1 text-[13px] leading-relaxed text-text-2">{it.a}</p>
                    </details>
                  ))}
                </div>
              </Card>
            ))}
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card title="الأسئلة الشائعة" className="lg:col-span-2">
              <div className="divide-y divide-line">
                {FAQ.map((f) => (
                  <details key={f.q} className="py-2">
                    <summary className="text-[13.5px] font-semibold text-text">{f.q}</summary>
                    <p className="mt-1 text-[13px] text-text-2">{f.a}</p>
                  </details>
                ))}
              </div>
            </Card>
            <div className="space-y-4">
              <Card title="تواصل مع الدعم" tone="dark">
                <div className="space-y-2 text-[13px] text-[#BCCBC5]">
                  <div>
                    البريد:{" "}
                    <a href={`mailto:${support.email ?? "support@darak.sa"}`} className="latin text-white hover:underline">
                      {support.email ?? "support@darak.sa"}
                    </a>
                  </div>
                  {support.whatsapp && (
                    <div>
                      واتساب:{" "}
                      <a href={support.whatsapp} target="_blank" rel="noopener noreferrer" className="num text-white hover:underline">
                        {support.phoneDisplay}
                      </a>
                    </div>
                  )}
                  <div>ساعات العمل: الأحد – الخميس، 9 ص – 6 م</div>
                  <Link href="/help?tab=tickets" className="btn btn-accent btn-sm mt-2 w-full">
                    فتح تذكرة دعم
                  </Link>
                </div>
              </Card>
            </div>
          </div>
        </div>
      )}

      {tab === "tickets" && (
        <div className="space-y-4">
          <StatGrid cols={3}>
            <StatCard label="تذاكر مفتوحة" value={<span className="num">{open}</span>} tone={open ? "warning" : undefined} />
            <StatCard label="إجمالي التذاكر" value={<span className="num">{tickets.length}</span>} />
            <StatCard label="وقت الاستجابة المستهدف" value="4 ساعات" sub="خلال ساعات العمل" />
          </StatGrid>
          <div className="grid gap-4 lg:grid-cols-3">
            <Card title="تذكرة جديدة" className="lg:col-span-1">
              <TicketForm />
            </Card>
            <Card title="تذاكر المكتب" className="lg:col-span-2" padded={false}>
              {tickets.length === 0 ? (
                <EmptyState title="لا توجد تذاكر" description="أرسل تذكرة من النموذج المجاور وسيتابعها فريق الدعم." />
              ) : (
                <Table>
                  <thead>
                    <tr>
                      <th>العنوان</th>
                      <th>الأولوية</th>
                      <th>الحالة</th>
                      <th>بواسطة</th>
                      <th>التاريخ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tickets.map((t) => (
                      <tr key={t.id}>
                        <td>
                          <details>
                            <summary className="font-semibold text-text">
                              {t.subject}
                              {t.subject.startsWith("[PDPL]") && (
                                <Tag tone="brand" plain className="mr-2">
                                  PDPL
                                </Tag>
                              )}
                            </summary>
                            <p className="mt-1 max-w-[460px] whitespace-pre-line text-[12.5px] text-text-2">{t.body}</p>
                          </details>
                        </td>
                        <td>
                          <StatusTag value={t.priority} map={TASK_PRIORITY} />
                        </td>
                        <td>
                          <StatusTag value={t.status} map={TICKET_STATUS} />
                        </td>
                        <td>{t.user?.name ?? "—"}</td>
                        <td className="num whitespace-nowrap text-muted" title={datetime(t.createdAt)}>
                          {relative(t.createdAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </Card>
          </div>
          <Alert tone="neutral">لطلبات أصحاب البيانات (PDPL) استخدم النموذج المخصص في الإعدادات ← الأمان والخصوصية لضمان معالجتها ضمن المدة النظامية.</Alert>
        </div>
      )}
    </>
  );
}
