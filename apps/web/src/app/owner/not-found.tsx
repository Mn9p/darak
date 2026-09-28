import Link from "next/link";
import { EmptyState, Card } from "@/components/ui";

export default function NotFound() {
  return (
    <div className="mx-auto mt-10 max-w-lg">
      <Card>
        <EmptyState
          title="السجل غير موجود"
          description="قد يكون السجل مؤرشفًا، أو خارج نطاق صلاحياتك، أو أن الرابط غير صحيح."
          action={
            <Link href="/owner" className="btn btn-primary">
              العودة للرئيسية
            </Link>
          }
        />
      </Card>
    </div>
  );
}
