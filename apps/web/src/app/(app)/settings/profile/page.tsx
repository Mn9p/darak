import Link from "next/link";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { ROLES } from "@/lib/constants";
import { datetime, relative } from "@/lib/format";
import { displayPhone } from "@/lib/phone";
import { PageHeader, Card, Table, ActionButton, Avatar, DL, EmptyState } from "@/components/ui";
import { ProfileForm } from "../ProfileForm";
import { revokeSession } from "../actions";
import { deviceLabel } from "@/lib/device";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const user = await requireStaff();
  const [me, sessions] = await Promise.all([
    db.user.findUnique({ where: { id: user.id }, include: { branch: { select: { name: true } }, manager: { select: { name: true } } } }),
    db.session.findMany({ where: { userId: user.id, revokedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" } }),
  ]);
  if (!me) redirect("/login");

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            <Avatar name={me.name} /> {me.name}
          </span>
        }
        subtitle={`${ROLES[user.role]?.label ?? user.role} · ${displayPhone(me.phone)}`}
        breadcrumbs={[{ label: "الإعدادات", href: "/settings" }, { label: "ملفي الشخصي" }]}
        actions={
          <Link href="/notifications" className="btn btn-outline btn-sm">
            تفضيلات الإشعارات
          </Link>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title="البيانات الشخصية" subtitle="رقم الجوال هو هوية الدخول؛ يتغير فقط بعد تأكيد رمز يُرسل إلى الرقم الجديد.">
            <ProfileForm user={{ name: me.name, phone: me.phone, email: me.email }} />
          </Card>
        </div>
        <Card title="بيانات العمل">
          <DL
            cols={1}
            items={[
              { label: "الدور", value: ROLES[user.role]?.label ?? user.role },
              { label: "الفرع", value: me.branch?.name },
              { label: "القسم", value: me.department },
              { label: "المسمى الوظيفي", value: me.jobTitle },
              { label: "الرقم الوظيفي", value: me.employeeCode ? <span className="latin">{me.employeeCode}</span> : null },
              { label: "المدير المباشر", value: me.manager?.name },
              { label: "آخر تسجيل دخول", value: <span className="num">{datetime(me.lastLoginAt)}</span> },
            ]}
          />
        </Card>
      </div>

      <div className="mt-4">
        <Card title="جلساتي النشطة" padded={false}>
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
    </div>
  );
}
