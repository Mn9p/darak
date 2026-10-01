import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { can, isAccountOwner, propertyIdScope } from "@/lib/permissions";
import { getOrgSettings } from "@/lib/engine";
import { EXPENSE_CATEGORIES, APPROVAL_STATUS, PAYMENT_METHODS, DOCUMENT_TYPES, AUDIT_ACTIONS, TASK_STATUS } from "@/lib/constants";
import { money, date, datetime, daysFromToday } from "@/lib/format";
import { PageHeader, Card, Table, StatusTag, Tabs, DL, EmptyState, ActionButton, Alert, Textarea, Field, StatGrid, StatCard } from "@/components/ui";
import { MoreMenu } from "@/components/MoreMenu";
import { approveExpense, rejectExpense } from "../actions";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "overview", label: "التفاصيل" },
  { key: "documents", label: "المستندات" },
  { key: "activity", label: "سجل العمليات" },
];

export default async function ExpensePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const user = await requireStaff();
  const { id } = await params;
  const { tab = "overview" } = await searchParams;
  const org = user.organizationId;

  const e = await db.expense.findFirst({
    where: { id, organizationId: org, ...propertyIdScope(user) },
    include: {
      property: { select: { id: true, name: true, code: true } },
      unit: { select: { id: true, number: true } },
      owner: { select: { id: true, name: true } },
      approvedBy: { select: { id: true, name: true } },
      createdBy: { select: { id: true, name: true } },
    },
  });
  if (!e) notFound();

  const [settings, docsCount, tasks] = await Promise.all([
    getOrgSettings(org),
    db.document.count({ where: { organizationId: org, entityType: "EXPENSE", entityId: id } }),
    db.task.findMany({ where: { organizationId: org, entityType: "EXPENSE", entityId: id }, orderBy: { createdAt: "desc" }, take: 5, include: { assignedTo: { select: { name: true } } } }),
  ]);
  const total = e.amount + e.vatAmount;
  const requiresManager = total > settings.managerApprovalLimit;
  const canApprove = can(user, "expenses.approve") && e.approvalStatus === "PENDING" && (!requiresManager || isAccountOwner(user));
  const canEdit = can(user, "expenses.manage") && (e.approvalStatus !== "APPROVED" || can(user, "expenses.approve"));
  const docHref = `/documents/new?entityType=EXPENSE&entityId=${e.id}&entityLabel=${encodeURIComponent(`${e.code} — ${e.description}`)}`;

  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            <span className="latin">{e.code}</span> <StatusTag value={e.approvalStatus} map={APPROVAL_STATUS} />
          </span>
        }
        subtitle={
          <>
            {e.description} · {EXPENSE_CATEGORIES[e.category] ?? e.category} · {date(e.date)}
          </>
        }
        breadcrumbs={[{ label: "المصروفات", href: "/expenses" }, { label: e.code }]}
        actions={
          <>
            {canApprove && (
              <ActionButton action={approveExpense} hidden={{ id: e.id }} className="btn btn-outline btn-sm">
                اعتماد
              </ActionButton>
            )}
            {canEdit && (
              <Link href={`/expenses/${e.id}/edit`} className="btn btn-primary btn-sm">
                تعديل
              </Link>
            )}
            <MoreMenu
              items={[
                can(user, "documents.manage") && { label: "إضافة مستند", href: docHref },
                canApprove && {
                  label: "رفض",
                  danger: true,
                  node: (
                    <ActionButton action={rejectExpense} hidden={{ id: e.id, reason: "رفض من صفحة المصروف" }} className="btn btn-ghost btn-sm text-danger" confirm="هل تريد رفض هذا المصروف؟">
                      رفض المصروف
                    </ActionButton>
                  ),
                },
              ]}
            />
          </>
        }
      />

      <StatGrid cols={3}>
        <StatCard label="المبلغ قبل الضريبة" value={money(e.amount, { decimals: true })} />
        <StatCard label="ضريبة القيمة المضافة" value={money(e.vatAmount, { decimals: true })} />
        <StatCard label="الإجمالي" value={money(total, { decimals: true })} sub="ر.س" dark />
      </StatGrid>

      <div className="mt-4">
        <Tabs tabs={[TABS[0], { ...TABS[1], count: docsCount }, TABS[2]]} active={tab} base={`/expenses/${e.id}`} />
      </div>

      {tab === "overview" && (
        <div className="grid gap-4 xl:grid-cols-3">
          <div className="space-y-4 xl:col-span-2">
            <Card title="بيانات المصروف">
              <DL
                cols={3}
                items={[
                  { label: "العقار", value: <Link className="link" href={`/properties/${e.property.id}`}>{e.property.name}</Link> },
                  { label: "الوحدة", value: e.unit ? <Link className="link latin" href={`/units/${e.unit.id}`}>{e.unit.number}</Link> : null },
                  { label: "المالك المحمّل عليه", value: e.owner ? <Link className="link" href={`/owners/${e.owner.id}`}>{e.owner.name}</Link> : null },
                  { label: "الجهة المستفيدة", value: e.payee },
                  { label: "رقم الفاتورة", value: e.invoiceNumber ? <span className="latin">{e.invoiceNumber}</span> : null },
                  { label: "طريقة الدفع", value: PAYMENT_METHODS[e.method] ?? e.method },
                  { label: "سجّله", value: e.createdBy?.name },
                  { label: "تاريخ التسجيل", value: datetime(e.createdAt) },
                  { label: "آخر تحديث", value: datetime(e.updatedAt) },
                ]}
              />
              {e.notes && <pre className="mt-4 whitespace-pre-wrap rounded-xl bg-mist px-4 py-3 font-[inherit] text-[13px] text-text-2">{e.notes}</pre>}
            </Card>

            {tasks.length > 0 && (
              <Card title="مهام الاعتماد المرتبطة">
                {tasks.map((t) => (
                  <div key={t.id} className="flex items-center justify-between border-b border-line-soft py-2 text-[13px] last:border-0">
                    <div>
                      <Link href={`/tasks/${t.id}`} className="font-semibold hover:text-brand">
                        {t.title}
                      </Link>
                      <div className="text-xs text-muted">{t.assignedTo?.name ?? "غير مسندة"} · {datetime(t.createdAt)}</div>
                    </div>
                    <StatusTag value={t.status} map={TASK_STATUS} />
                  </div>
                ))}
              </Card>
            )}
          </div>

          <div className="space-y-4">
            <Card title="الاعتماد">
              <div className="mb-3 flex items-center gap-2">
                <StatusTag value={e.approvalStatus} map={APPROVAL_STATUS} />
                {e.approvedBy && e.approvalStatus !== "PENDING" && (
                  <span className="text-[12.5px] text-muted">
                    بواسطة <b>{e.approvedBy.name}</b> · {datetime(e.approvedAt)}
                  </span>
                )}
              </div>
              <div className="mb-3 text-[12.5px] text-muted">
                حد الاعتماد التلقائي <span className="num">{money(settings.autoApproveLimit)}</span> ر.س · حد اعتماد المحاسب <span className="num">{money(settings.managerApprovalLimit)}</span> ر.س
              </div>
              {e.approvalStatus === "PENDING" && requiresManager && <div className="mb-3"><Alert tone="warning">يتجاوز حد الاعتماد للموظفين ويتطلب اعتماد صاحب الحساب.</Alert></div>}
              {e.approvalStatus === "PENDING" && !can(user, "expenses.approve") && <Alert tone="info">بانتظار اعتماد صاحب الحساب أو موظف يملك صلاحية الاعتماد.</Alert>}
              {canApprove && (
                <form action={rejectExpense} className="space-y-2 border-t border-line pt-3">
                  <input type="hidden" name="id" value={e.id} />
                  <Field label="سبب الرفض" name="reason">
                    <Textarea name="reason" rows={2} placeholder="يظهر لمن سجّل المصروف" />
                  </Field>
                  <button type="submit" className="btn btn-danger-soft btn-sm w-full">
                    رفض مع ذكر السبب
                  </button>
                </form>
              )}
              {e.approvalStatus === "REJECTED" && can(user, "expenses.manage") && <p className="help">يمكن تعديل المصروف المرفوض وإعادة إرساله للاعتماد.</p>}
            </Card>

          </div>
        </div>
      )}

      {tab === "documents" && <DocumentsTab expenseId={e.id} href={docHref} canManage={can(user, "documents.manage")} />}
      {tab === "activity" && <ActivityTab expenseId={e.id} />}
    </>
  );
}

async function DocumentsTab({ expenseId, href, canManage }: { expenseId: string; href: string; canManage: boolean }) {
  const rows = await db.document.findMany({ where: { entityType: "EXPENSE", entityId: expenseId }, orderBy: { createdAt: "desc" }, include: { uploadedBy: { select: { name: true } } } });
  return (
    <Card padded={false} title="المستندات" actions={canManage ? <Link href={href} className="btn btn-primary btn-sm">إضافة مستند</Link> : undefined}>
      {rows.length === 0 ? (
        <EmptyState title="لا توجد مستندات" description="ارفع الفاتورة أو الإيصال لتوثيق المصروف." action={canManage ? <Link href={href} className="btn btn-primary">رفع فاتورة</Link> : undefined} />
      ) : (
        <Table>
          <thead>
            <tr>
              <th>المستند</th>
              <th>النوع</th>
              <th>تاريخ الإصدار</th>
              <th>الانتهاء</th>
              <th>رفعه</th>
              <th>الإصدار</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => {
              const left = d.expiryDate ? daysFromToday(d.expiryDate) : null;
              return (
                <tr key={d.id}>
                  <td>
                    <Link href={`/documents/${d.id}`} className="cell-primary hover:text-brand">
                      {d.name}
                    </Link>
                  </td>
                  <td>{DOCUMENT_TYPES[d.type] ?? d.type}</td>
                  <td>{date(d.issueDate)}</td>
                  <td>{d.expiryDate ? <span className={left !== null && left < 0 ? "text-danger" : ""}>{date(d.expiryDate)}</span> : "—"}</td>
                  <td className="text-muted">{d.uploadedBy?.name ?? "—"}</td>
                  <td className="num">v{d.version}</td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

async function ActivityTab({ expenseId }: { expenseId: string }) {
  const rows = await db.auditLog.findMany({ where: { entityType: "EXPENSE", entityId: expenseId }, orderBy: { createdAt: "desc" }, take: 50 });
  return (
    <Card title="سجل العمليات">
      {rows.length === 0 ? (
        <EmptyState title="لا توجد عمليات مسجلة" />
      ) : (
        <div className="timeline">
          {rows.map((a) => (
            <div key={a.id} className={`timeline-item ${a.action === "REJECT" ? "danger" : ""}`}>
              <div className="text-[13px]">
                <StatusTag value={a.action} map={AUDIT_ACTIONS} /> <b>{a.userName}</b> {a.entityLabel && <span className="text-muted">— {a.entityLabel}</span>}
              </div>
              <div className="text-[11.5px] text-faint">{datetime(a.createdAt)}</div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
