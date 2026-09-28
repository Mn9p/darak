import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { can, isScoped } from "@/lib/permissions";
import { LEAD_STAGES, LEAD_STAGE_ORDER, LEAD_SOURCES, UNIT_STATUS, AUDIT_ACTIONS } from "@/lib/constants";
import { money, date, datetime, relative } from "@/lib/format";
import { PageHeader, Card, StatusTag, DL, ActionButton, EmptyState, Alert, Field, Input, KV } from "@/components/ui";
import { MoreMenu, Optional } from "@/components/MoreMenu";
import { moveStage, markLost, reopenLead } from "../actions";
import { displayPhone, telHref } from "@/lib/phone";

export const dynamic = "force-dynamic";

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireStaff();
  const { id } = await params;
  const org = user.organizationId;
  const lead = await db.lead.findFirst({
    where: { id, organizationId: org, ...(isScoped(user) ? { OR: [{ unitId: null }, { unit: { propertyId: { in: user.assignedPropertyIds } } }] } : {}) },
    include: {
      unit: { include: { property: { select: { id: true, name: true } } } },
      assignedTo: { select: { id: true, name: true } },
    },
  });
  if (!lead) notFound();

  const activity = await db.auditLog.findMany({ where: { entityType: "LEAD", entityId: id }, orderBy: { createdAt: "desc" }, take: 30 });
  const manage = can(user, "leasing.manage");
  const idx = LEAD_STAGE_ORDER.indexOf(lead.stage);
  const prev = idx > 0 ? LEAD_STAGE_ORDER[idx - 1] : null;
  const next = idx >= 0 && idx < LEAD_STAGE_ORDER.length - 1 ? LEAD_STAGE_ORDER[idx + 1] : null;
  const isRented = lead.stage === "RENTED";
  const isLost = lead.stage === "LOST";
  const active = manage && !isRented && !isLost;
  const canContract = ["APPROVED", "CONTRACTING"].includes(lead.stage) && can(user, "contracts.manage");
  const nextStage = active && next && next !== "RENTED" ? next : null;
  const contractHref = `/contracts/new?${new URLSearchParams({
    ...(lead.unitId ? { unitId: lead.unitId } : {}),
    ...(lead.unit ? { propertyId: lead.unit.propertyId } : {}),
    leadId: lead.id,
    tenantName: lead.name,
    ...(lead.phone ? { phone: lead.phone } : {}),
    ...(lead.offerAmount ? { totalAmount: String(lead.offerAmount) } : {}),
  }).toString()}`;

  // One primary action: create contract > move to next stage > edit.
  const primary: "contract" | "next" | "edit" | null = canContract ? "contract" : nextStage ? "next" : manage && !isRented ? "edit" : null;

  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {lead.name} <StatusTag value={lead.stage} map={LEAD_STAGES} />
          </span>
        }
        subtitle={
          <span>
            {LEAD_SOURCES[lead.source] ?? lead.source} · أُضيف {date(lead.createdAt)}
            {lead.assignedTo ? ` · المسؤول: ${lead.assignedTo.name}` : ""}
          </span>
        }
        breadcrumbs={[{ label: "التأجير", href: "/leasing" }, { label: lead.name }]}
        actions={
          <>
            {primary !== "edit" && manage && !isRented && (
              <Link href={`/leasing/${lead.id}/edit`} className="btn btn-outline btn-sm">
                تعديل
              </Link>
            )}
            {primary === "contract" && (
              <Link href={contractHref} className="btn btn-primary btn-sm">
                إنشاء عقد
              </Link>
            )}
            {primary === "next" && nextStage && (
              <ActionButton action={moveStage} hidden={{ id: lead.id, stage: nextStage }} className="btn btn-primary btn-sm">
                نقل إلى {LEAD_STAGES[nextStage].label}
              </ActionButton>
            )}
            {primary === "edit" && (
              <Link href={`/leasing/${lead.id}/edit`} className="btn btn-primary btn-sm">
                تعديل
              </Link>
            )}
            <MoreMenu
              items={[
                primary !== "next" && nextStage && { label: `نقل إلى ${LEAD_STAGES[nextStage].label}`, node: <ActionButton action={moveStage} hidden={{ id: lead.id, stage: nextStage }}>نقل إلى {LEAD_STAGES[nextStage].label}</ActionButton> },
                active && prev && { label: `رجوع إلى ${LEAD_STAGES[prev].label}`, node: <ActionButton action={moveStage} hidden={{ id: lead.id, stage: prev }}>رجوع إلى {LEAD_STAGES[prev].label}</ActionButton> },
                manage && isLost && { label: "إعادة فتح العميل", node: <ActionButton action={reopenLead} hidden={{ id: lead.id }}>إعادة فتح العميل</ActionButton> },
              ]}
            />
          </>
        }
      />

      {/* Stage stepper */}
      <Card>
        <ol className="flex flex-wrap items-center gap-2">
          {LEAD_STAGE_ORDER.map((s, i) => {
            const state = isLost ? "lost" : i < idx ? "done" : i === idx ? "current" : "todo";
            const cls = state === "done" ? "bg-brand text-white" : state === "current" ? "bg-sand text-ink ring-2 ring-sand/40" : "bg-mist text-muted";
            return (
              <li key={s} className="flex items-center gap-2">
                <span className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-[12.5px] font-bold ${cls}`}>
                  <span className="num">{i + 1}</span> {LEAD_STAGES[s].label}
                </span>
                {i < LEAD_STAGE_ORDER.length - 1 && <span className="text-faint">←</span>}
              </li>
            );
          })}
          {isLost && (
            <li>
              <StatusTag value="LOST" map={LEAD_STAGES} />
            </li>
          )}
        </ol>
        {isLost && lead.lostReason && (
          <div className="mt-3">
            <Alert tone="danger" title="سبب الانسحاب">
              {lead.lostReason}
            </Alert>
          </div>
        )}
        {isRented && (
          <div className="mt-3">
            <Alert tone="success">تم تحويل هذا العميل إلى مستأجر وإنشاء عقد.</Alert>
          </div>
        )}
        {active && next === "RENTED" && <p className="mt-3 text-[12.5px] text-muted">تتحول المرحلة إلى «تم التأجير» تلقائيًا عند تفعيل العقد.</p>}
      </Card>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card title="بيانات العميل" className="xl:col-span-2">
          <DL
            cols={3}
            items={[
              { label: "الجوال", value: lead.phone ? <a className="link num" href={telHref(lead.phone)}>{displayPhone(lead.phone)}</a> : null },
              { label: "البريد", value: lead.email ? <span className="latin">{lead.email}</span> : null },
              { label: "موعد المعاينة", value: lead.viewingDate ? `${datetime(lead.viewingDate)} (${relative(lead.viewingDate)})` : null },
              { label: "قيمة العرض", value: lead.offerAmount ? <span className="num">{money(lead.offerAmount)} ر.س / سنة</span> : null },
              { label: "آخر تحديث", value: datetime(lead.updatedAt) },
            ]}
          />
          {lead.notes && <p className="mt-4 rounded-xl bg-mist px-4 py-3 text-[13px] text-text-2">{lead.notes}</p>}
        </Card>

        <div className="space-y-4">
          <Card title="الوحدة المطلوبة">
            {lead.unit ? (
              <>
                <div className="flex items-center justify-between">
                  <div>
                    <Link href={`/units/${lead.unit.id}`} className="latin text-lg font-bold hover:text-brand">
                      {lead.unit.number}
                    </Link>
                    <div className="text-[12.5px] text-muted">
                      <Link href={`/properties/${lead.unit.property.id}`} className="hover:text-brand">
                        {lead.unit.property.name}
                      </Link>
                    </div>
                  </div>
                  <StatusTag value={lead.unit.status} map={UNIT_STATUS} />
                </div>
                <div className="mt-3">
                  <KV k="الإيجار المستهدف" v={<span className="num">{money(lead.unit.targetRent)}</span>} />
                  <KV k="العرض المقدم" v={<span className="num">{money(lead.offerAmount)}</span>} />
                  {lead.unit.targetRent && lead.offerAmount ? (
                    <KV k="الفرق" v={<span className={`num ${lead.offerAmount < lead.unit.targetRent ? "text-danger" : "text-success"}`}>{money(lead.offerAmount - lead.unit.targetRent)}</span>} />
                  ) : null}
                </div>
              </>
            ) : (
              <p className="text-[13px] text-muted">لم تُحدَّد وحدة بعد. يمكنك ربط وحدة من صفحة التعديل.</p>
            )}
          </Card>

          {active && (
            <Optional title="تسجيل انسحاب">
              <form action={markLost} className="space-y-3">
                <input type="hidden" name="id" value={lead.id} />
                <Field label="سبب الانسحاب" name="reason" required>
                  <Input name="reason" required placeholder="مثال: وجد وحدة أرخص" />
                </Field>
                <button type="submit" className="btn btn-danger-soft btn-sm">
                  تحديد كمنسحب
                </button>
              </form>
            </Optional>
          )}
        </div>
      </div>

      <Card title="سجل العمليات" className="mt-4">
        {activity.length === 0 ? (
          <EmptyState title="لا توجد عمليات مسجلة" />
        ) : (
          <div className="timeline">
            {activity.map((a) => (
              <div key={a.id} className="timeline-item">
                <div className="text-[13px]">
                  <StatusTag value={a.action} map={AUDIT_ACTIONS} /> <b>{a.userName}</b>
                  {a.action === "STATUS_CHANGE" && a.newValue && <span className="text-muted"> — {stageFromJson(a.newValue)}</span>}
                </div>
                <div className="text-[11.5px] text-faint">{datetime(a.createdAt)}</div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}

function stageFromJson(s: string) {
  try {
    const v = JSON.parse(s) as { stage?: string; lostReason?: string };
    const label = v.stage ? LEAD_STAGES[v.stage]?.label ?? v.stage : "";
    return v.lostReason ? `${label}: ${v.lostReason}` : label;
  } catch {
    return "";
  }
}
