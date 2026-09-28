import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { PageHeader, Card, Alert, Input, ActionButton, Tag } from "@/components/ui";
import { addCustomField, removeCustomField, addTag, removeTag } from "../actions";
import { readSettings, type CustomFieldEntity } from "../lib";

export const dynamic = "force-dynamic";

const ENTITIES: { key: CustomFieldEntity; label: string; example: string }[] = [
  { key: "PROPERTY", label: "العقارات", example: "رقم العداد، مدير المنطقة" },
  { key: "UNIT", label: "الوحدات", example: "رقم عداد الكهرباء، الاتجاه" },
  { key: "TENANT", label: "المستأجرون", example: "جهة الكفالة، رقم الملف" },
  { key: "OWNER", label: "الملاك", example: "رقم العقد الإداري، المفوض" },
];

export default async function CustomFieldsPage() {
  const user = await requireStaff();
  if (!can(user, "settings.manage")) redirect("/forbidden");
  const s = await readSettings(user.organizationId);

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="الحقول المخصصة والوسوم" subtitle="حقول ووسوم خاصة بمكتبك تظهر في النماذج وصفحات العرض." breadcrumbs={[{ label: "الإعدادات", href: "/settings" }, { label: "الحقول المخصصة" }]} />

      <div className="grid gap-4 md:grid-cols-2">
        {ENTITIES.map((e) => (
          <Card key={e.key} title={e.label} subtitle={`أمثلة: ${e.example}`}>
            <div className="mb-3 flex flex-wrap gap-1.5">
              {s.customFields[e.key].length === 0 && <span className="text-[13px] text-faint">لا توجد حقول مخصصة بعد</span>}
              {s.customFields[e.key].map((k) => (
                <span key={k} className="tag tag-neutral flex items-center gap-1">
                  {k}
                  <ActionButton action={removeCustomField} hidden={{ entity: e.key, key: k }} className="text-muted hover:text-danger" confirm={`حذف الحقل «${k}»؟ لن تُحذف القيم المسجلة سابقًا.`}>
                    ×
                  </ActionButton>
                </span>
              ))}
            </div>
            <form action={addCustomField} className="flex items-end gap-2">
              <input type="hidden" name="entity" value={e.key} />
              <div className="flex-1">
                <Input name="key" id={`key_${e.key}`} placeholder="اسم الحقل الجديد" maxLength={40} required />
              </div>
              <button type="submit" className="btn btn-outline btn-sm">
                إضافة
              </button>
            </form>
          </Card>
        ))}
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <Card title="الوسوم" subtitle="وسوم موحدة للعقارات والملاك والمستأجرين.">
          <div className="mb-3 flex flex-wrap gap-1.5">
            {s.tags.length === 0 && <span className="text-[13px] text-faint">لا توجد وسوم معرّفة بعد</span>}
            {s.tags.map((t) => (
              <span key={t} className="tag tag-brand flex items-center gap-1">
                {t}
                <ActionButton action={removeTag} hidden={{ tag: t }} className="text-muted hover:text-danger">
                  ×
                </ActionButton>
              </span>
            ))}
          </div>
          <form action={addTag} className="flex items-end gap-2">
            <div className="flex-1">
              <Input name="tag" placeholder="وسم جديد" maxLength={40} required />
            </div>
            <button type="submit" className="btn btn-outline btn-sm">
              إضافة
            </button>
          </form>
        </Card>
        <Card title="الحالات">
          <Alert tone="info">
            حالات العقود والأقساط والوحدات ثابتة حفاظًا على سلامة التحصيل والتقارير. استخدم <Tag tone="brand" plain>الوسوم</Tag> أو الحقول المخصصة للتصنيفات الداخلية، ولطلب حالة إضافية تواصل مع الدعم من مركز المساعدة.
          </Alert>
        </Card>
      </div>
    </div>
  );
}
