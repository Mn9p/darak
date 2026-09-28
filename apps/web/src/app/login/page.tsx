import Link from "next/link";
import { LoginForm } from "./LoginForm";
import { supportContact } from "@/lib/support";
import { AuthShell } from "@/components/AuthShell";
import { getCurrentUser, homeForRole } from "@/lib/auth";
import { redirect } from "next/navigation";

export const metadata = { title: "تسجيل الدخول" };
export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await getCurrentUser();
  if (user) redirect(homeForRole(user.role, Boolean(user.organizationId)));
  const { next, expired, phone } = await searchParams;
  const support = supportContact();

  return (
    <AuthShell
      title="الدخول برقم الجوال"
      subtitle="للمكتب العقاري، وللمالك، وللمستأجر. رقم واحد يفتح حسابك في ثوانٍ."
      width="max-w-[420px]"
      footer={
        <>
          مالك أو مستأجر؟ ادخل بالرقم المسجل لدى مكتبك، وستفتح بوابتك مباشرة. مكتب جديد؟{" "}
          <Link href="/#request" className="link font-bold">
            اطلب حسابًا
          </Link>
          .
        </>
      }
    >
      <LoginForm next={next} expired={expired === "1"} startPhone={phone} support={{ whatsapp: support.whatsapp, phoneDisplay: support.phoneDisplay, email: support.email }} />
    </AuthShell>
  );
}
