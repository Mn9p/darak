import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { PLANS } from "@/lib/constants";
import { datetime, relative } from "@/lib/format";
import { displayPhone } from "@/lib/phone";
import { PageHeader, Card, Table, Tag, ActionButton, Alert, KV, EmptyState } from "@/components/ui";
import { revokeSession } from "../actions";
import { PdplForm } from "../PdplForm";
import { deviceLabel } from "@/lib/device";

export const dynamic = "force-dynamic";

export default async function SecurityPage() {
  const user = await requireStaff();
  const [me, org, sessions, pdpl] = await Promise.all([
    db.user.findUnique({ where: { id: user.id }, select: { phone: true, lastLoginAt: true } }),
    db.organization.findUnique({ where: { id: user.organizationId }, select: { plan: true } }),
    db.session.findMany({ where: { userId: user.id, revokedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" } }),
    db.supportTicket.findMany({ where: { organizationId: user.organizationId, subject: { startsWith: "[PDPL]" } }, orderBy: { createdAt: "desc" }, take: 5 }),
  ]);
  const enterprise = org?.plan === "ENTERPRISE";
  const manage = can(user, "settings.manage");

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="الأمان والخصوصية" subtitle="حماية الحساب والجلسات وطلبات حماية البيانات الشخصية." breadcrumbs={[{ label: "الإعدادات", href: "/settings" }, { label: "الأمان" }]} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="طريقة الدخول" subtitle="لا توجد كلمة مرور. يُرسل رمز تحقق إلى جوالك عند كل تسجيل دخول.">
          <KV k="رقم الجوال المسجّل" v={<span className="latin">{me?.phone ? displayPhone(me.phone) : "—"}</span>} />
          <KV k="صلاحية الرمز" v={<span className="num">5 دقائق</span>} />
          <KV k="المحاولات المسموحة لكل رمز" v={<span className="num">5 محاولات</span>} />
          <KV k="مدة الجلسة" v={<span className="num">7 أيام</span>} />
          <KV k="الأجهزة الموثوقة" v="تُدار من الجلسات النشطة أدناه" />
          <KV k="تغيير رقم الجوال" v={<Link className="link" href="/settings/profile">من الملف الشخصي</Link>} />
        </Card>

        <Card title="خيارات المؤسسات" subtitle="ضوابط إضافية على مستوى المكتب.">
          <div className="space-y-2">
            {["تسجيل الدخول الموحد", "قائمة عناوين IP المسموحة", "تقييد الدخول بالأجهزة المعتمدة"].map((k) => (
              <div key={k} className="flex items-center justify-between text-[13px]">
                <span className={enterprise ? "text-text" : "text-muted"}>{k}</span>
                <button type="button" className="btn btn-ghost btn-xs" disabled title={enterprise ? "يفعّله فريق دارك عند الطلب" : "متاح في خطة المؤسسات"}>
                  {enterprise ? "عند الطلب" : `متاح في خطة ${PLANS.ENTERPRISE.label}`}
                </button>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="mt-4">
        <Card title="الجلسات النشطة" subtitle={`آخر تسجيل دخول: ${me?.lastLoginAt ? datetime(me.lastLoginAt) : "—"}`} padded={false}>
          {sessions.length === 0 ? (
            <EmptyState title="لا توجد جلسات نشطة" />
          ) : (
            <Table>
              <thead>
                <tr>
                  <th>الجهاز</th>
                  <th>IP</th>
                  <th>بدأت</th>
                  <th>تنتهي</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr key={s.id}>
                    <td className="max-w-[360px] truncate text-[12.5px]" title={s.device ?? ""}>
                      {deviceLabel(s.device)}
                      {s.id === user.sessionId && <span className="tag tag-success mr-2">هذا الجهاز</span>}
                    </td>
                    <td className="num">{s.ip ?? "—"}</td>
                    <td className="num text-muted">{datetime(s.createdAt)}</td>
                    <td className="text-muted">{relative(s.expiresAt)}</td>
                    <td>
                      {s.id !== user.sessionId && (
                        <ActionButton action={revokeSession} hidden={{ id: s.id }} className="btn btn-danger-soft btn-xs" confirm="إنهاء هذه الجلسة؟ سيُطلب من ذلك الجهاز تسجيل الدخول من جديد.">
                          إنهاء
                        </ActionButton>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="سياسة الاحتفاظ بالبيانات">
          <ul className="list-inside list-disc space-y-1 text-[13px] text-text-2">
            <li>البيانات المالية والعقود: تُحفظ 10 سنوات وفق متطلبات هيئة الزكاة والضريبة والجمارك.</li>
            <li>سجل العمليات: لا يُعدّل ولا يُحذف، ويُحفظ طوال مدة الاشتراك.</li>
            <li>بيانات المستأجرين المنتهية عقودهم: تُؤرشف بعد 24 شهرًا من انتهاء آخر عقد ما لم يوجد التزام مالي.</li>
            <li>النسخ الاحتياطية: يومية، مشفرة، داخل المملكة، وتُحفظ 30 يومًا.</li>
            <li>عند إنهاء الاشتراك: تصدير كامل للبيانات خلال 30 يومًا ثم إتلاف آمن.</li>
          </ul>
          {manage && (
            <div className="mt-3">
              <Alert tone="neutral">لتعديل مدد الاحتفاظ تواصل مع الدعم من مركز المساعدة.</Alert>
            </div>
          )}
        </Card>

        <Card title="حماية البيانات الشخصية" subtitle="طلبات أصحاب البيانات، والرد خلال 30 يومًا.">
          <p className="mb-3 text-[13px] text-text-2">يحق للملاك والمستأجرين والموظفين طلب الاطلاع على بياناتهم أو تصحيحها أو حذفها. يُتابع الطلب كتذكرة بأولوية عالية.</p>
          <PdplForm />
          {pdpl.length > 0 && (
            <div className="mt-4 border-t border-line pt-3">
              <div className="mb-2 text-[12.5px] font-bold text-muted">آخر الطلبات</div>
              <ul className="space-y-1 text-[13px]">
                {pdpl.map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-2">
                    <span className="truncate">{t.subject.replace("[PDPL] ", "")}</span>
                    <span className="flex items-center gap-2 text-[12px] text-muted">
                      {relative(t.createdAt)}
                      <Tag tone={t.status === "RESOLVED" || t.status === "CLOSED" ? "success" : "warning"} plain>
                        {t.status === "OPEN" ? "مفتوح" : t.status === "IN_PROGRESS" ? "قيد المعالجة" : t.status === "RESOLVED" ? "تم الحل" : "مغلق"}
                      </Tag>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
