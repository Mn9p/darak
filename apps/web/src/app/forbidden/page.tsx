import Link from "next/link";
import { LogoMark } from "@/components/Logo";

export default function Forbidden() {
  return (
    <div className="grid min-h-screen place-items-center bg-mist p-6">
      <div className="card max-w-md p-8 text-center">
        <LogoMark size={44} className="mx-auto" />
        <h1 className="mt-4 text-xl font-bold text-ink">لا تملك صلاحية الوصول</h1>
        <p className="mt-2 text-[13.5px] text-muted">هذه الصفحة خارج نطاق صلاحياتك. إذا كنت تعتقد أن هذا خطأ، تواصل مع مدير المكتب.</p>
        <Link href="/" className="btn btn-primary mt-5">
          العودة للرئيسية
        </Link>
      </div>
    </div>
  );
}
