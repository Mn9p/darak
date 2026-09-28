import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { can, propertyIdScope } from "@/lib/permissions";
import { buildSchedule, annualRent, contractMonths } from "@/lib/engine";
import { CONTRACT_STATUS, RENEWAL_STATUS, PAYMENT_FREQUENCY, INSTALLMENT_STATUS, PAYMENT_STATUS, PAYMENT_METHODS, DOCUMENT_TYPES, AUDIT_ACTIONS, UNIT_TYPES } from "@/lib/constants";
import { money, pct, date, datetime, daysFromToday, daysOverdue, addDays, inputDate } from "@/lib/format";
import { HeroHeader, Card, Table, StatusTag, Tabs, DL, StatGrid, StatCard, Progress, EmptyState, Tag, ActionButton, KV, Alert, Field, Input, Select } from "@/components/ui";
import { MoreMenu, Optional } from "@/components/MoreMenu";
import { activateContract, approveContract, rejectContract, cancelContract, setRenewalStatus, renewContract, terminateContract } from "../actions";
import { RenewalForm, TerminationForm } from "./ContractPanels";

export const dynamic = "force-dynamic";

const OPEN = ["ACTIVE", "EXPIRING_SOON", "RENEWAL_PENDING"];
const EDITABLE = ["DRAFT", "PENDING_APPROVAL"];

export default async function ContractPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const user = await requireStaff();
  const { id } = await params;
  const { tab = "overview" } = await searchParams;
  const org = user.organizationId;

  const c = await db.contract.findFirst({
    where: { id, organizationId: org, ...propertyIdScope(user) },
    include: {
      property: { select: { id: true, name: true, city: true, district: true } },
      unit: { select: { id: true, number: true, type: true, floor: true, area: true, status: true } },
      tenant: { select: { id: true, name: true, phone: true, email: true, nationalId: true, riskLevel: true } },
      owner: { select: { id: true, name: true, phone: true, managementFeePct: true } },
      createdBy: { select: { id: true, name: true } },
      installments: { orderBy: { seq: "asc" }, include: { collectionCase: { select: { id: true, followUpStatus: true } } } },
    },
  });
  if (!c) notFound();

  const [renewal, renewedFrom] = await Promise.all([
    db.contract.findFirst({ where: { organizationId: org, renewedFromId: c.id, status: { not: "CANCELLED" } }, select: { id: true, code: true, status: true, startDate: true, endDate: true, totalAmount: true } }),
    c.renewedFromId ? db.contract.findFirst({ where: { id: c.renewedFromId, organizationId: org }, select: { id: true, code: true, totalAmount: true, endDate: true } }) : Promise.resolve(null),
  ]);

  const open = OPEN.includes(c.status);
  const editable = EDITABLE.includes(c.status);
  const left = daysFromToday(c.endDate);
  const manage = can(user, "contracts.manage");
  const approve = can(user, "contracts.approve");
  const schedule = c.installments.length ? c.installments : buildSchedule({ startDate: c.startDate, totalAmount: Math.round((c.totalAmount + (c.vatAmount || 0)) * 100) / 100, frequency: c.paymentFrequency, installmentsCount: c.installmentsCount, months: contractMonths(c.startDate, c.endDate) }).map((r) => ({ ...r, id: `p${r.seq}`, paidAmount: 0, status: "UPCOMING", collectionCase: null, waivedReason: null }));
  const totalDue = c.installments.filter((i) => i.status !== "WAIVED").reduce((s, i) => s + i.amount, 0);
  const paid = c.installments.reduce((s, i) => s + i.paidAmount, 0);
  const remaining = totalDue - paid;
  const overdueRows = c.installments.filter((i) => ["OVERDUE", "PARTIALLY_PAID", "DUE"].includes(i.status) && daysOverdue(i.dueDate) > 0);
  const overdueAmt = overdueRows.reduce((s, i) => s + i.amount - i.paidAmount, 0);
  const unpaid = c.installments.filter((i) => i.status !== "PAID" && i.status !== "WAIVED" && i.amount - i.paidAmount > 0.01 && i.dueDate <= new Date());
  const unpaidAmt = unpaid.reduce((s, i) => s + i.amount - i.paidAmount, 0);
  const progress = totalDue ? (paid / totalDue) * 100 : 0;

  // One primary action per status: approve > activate > record payment > edit.
  const canApproveNow = manage && approve && c.status === "PENDING_APPROVAL";
  const canActivate = manage && c.status === "DRAFT";
  const canPay = can(user, "payments.manage") && open;
  const canEdit = manage && editable;
  const primary: "approve" | "activate" | "pay" | "edit" | null = canApproveNow ? "approve" : canActivate ? "activate" : canPay ? "pay" : canEdit ? "edit" : null;

  const TABS = [
    { key: "overview", label: "نظرة عامة" },
    { key: "installments", label: "الدفعات", count: c.installments.length },
    { key: "payments", label: "سندات القبض" },
    { key: "renewal", label: "التجديد" },
    { key: "termination", label: "الإنهاء" },
    { key: "documents", label: "المستندات" },
    { key: "activity", label: "سجل العمليات" },
  ];

  return (
    <>
      <HeroHeader
        title={<Link href={`/tenants/${c.tenant.id}`} className="hover:text-brand">{c.tenant.name}</Link>}
        code={c.code}
        status={
          <>
            <StatusTag value={c.status} map={CONTRACT_STATUS} />
            {c.renewalStatus && open && <StatusTag value={c.renewalStatus} map={RENEWAL_STATUS} />}
          </>
        }
        meta={[
          <span key="unit">
            الوحدة <Link href={`/units/${c.unit.id}`} className="link latin">{c.unit.number}</Link> — <Link href={`/properties/${c.property.id}`} className="link">{c.property.name}</Link>
          </span>,
          <span key="dates" className="latin">
            {date(c.startDate)} ← {date(c.endDate)}
          </span>,
          open && <b key="left" className={left <= 30 ? "text-danger" : left <= 90 ? "text-warning" : "text-success"}>{left < 0 ? `منتهي منذ ${-left} يوم` : `متبقٍ ${left} يوم`}</b>,
          <span key="owner">
            المؤجر: <Link href={`/owners/${c.owner.id}`} className="link">{c.owner.name}</Link>
          </span>,
        ]}
        breadcrumbs={[{ label: "العقود", href: "/contracts" }, { label: c.code }]}
        actions={
          <>
            {canEdit && primary !== "edit" && (
              <Link href={`/contracts/${c.id}/edit`} className="btn btn-outline btn-sm">
                تعديل
              </Link>
            )}
            {primary === "approve" && (
              <ActionButton action={approveContract} hidden={{ id: c.id }} className="btn btn-primary btn-sm">
                اعتماد وتفعيل
              </ActionButton>
            )}
            {primary === "activate" && (
              <ActionButton action={activateContract} hidden={{ id: c.id }} className="btn btn-primary btn-sm">
                {approve ? "تفعيل العقد" : "إرسال للاعتماد"}
              </ActionButton>
            )}
            {primary === "pay" && (
              <Link href={`/payments/new?tenantId=${c.tenant.id}&contractId=${c.id}`} className="btn btn-primary btn-sm">
                تسجيل دفعة
              </Link>
            )}
            {primary === "edit" && (
              <Link href={`/contracts/${c.id}/edit`} className="btn btn-primary btn-sm">
                تعديل
              </Link>
            )}
            <MoreMenu
              items={[
                manage && (open || c.status === "EXPIRED") && !renewal && { label: "تجديد العقد", href: `/contracts/${c.id}?tab=renewal` },
                manage && (open || c.status === "EXPIRED") && { label: "إنهاء العقد", href: `/contracts/${c.id}?tab=termination` },
                can(user, "documents.manage") && { label: "إضافة مستند", href: `/documents/new?entityType=CONTRACT&entityId=${c.id}&entityLabel=${encodeURIComponent(c.code)}` },
                manage && (editable || c.status === "PENDING_APPROVAL") && { label: "إلغاء العقد", danger: true, node: <ActionButton action={cancelContract} hidden={{ id: c.id }} className="btn btn-ghost btn-sm text-danger" confirm="إلغاء العقد نهائيًا؟ لا يمكن التراجع عن الإلغاء.">إلغاء العقد</ActionButton> },
              ]}
            />
          </>
        }
      />

      <StatGrid cols={4}>
        <StatCard label="قيمة العقد" value={money(c.totalAmount)} sub={`${c.installments.filter((i) => i.status === "PAID").length}/${c.installments.length || c.installmentsCount} قسط · ${PAYMENT_FREQUENCY[c.paymentFrequency]}`} />
        <StatCard label="المحصل" value={money(paid)} tone="success" sub={<Progress value={progress} />} />
        <StatCard label="المتبقي" value={money(remaining)} />
        <StatCard label="المتأخر" value={money(overdueAmt)} tone={overdueAmt > 0 ? "danger" : undefined} href={overdueAmt > 0 ? `/installments?contractId=${c.id}&status=OVERDUE` : undefined} />
      </StatGrid>

      <div className="mt-4">
        <Tabs tabs={TABS} active={tab} base={`/contracts/${c.id}`} sticky />
      </div>

      {tab === "overview" && (
        <div className="grid gap-4 xl:grid-cols-3">
          <div className="space-y-4 xl:col-span-2">
            {c.status === "DRAFT" && (
              <Alert tone="warning" title="العقد غير مفعّل">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>لن تُنشأ الدفعات حتى التفعيل، وتبقى الوحدة غير مؤجرة.</span>
                  {canActivate && (
                    <ActionButton action={activateContract} hidden={{ id: c.id }} className="btn btn-primary btn-xs">
                      {approve ? "تفعيل العقد الآن" : "إرسال للاعتماد"}
                    </ActionButton>
                  )}
                </div>
              </Alert>
            )}
            {c.status === "PENDING_APPROVAL" && (
              <Alert tone="warning" title="بانتظار الاعتماد">
                أنشأه {c.createdBy?.name ?? "—"} في {datetime(c.createdAt)}. {approve ? "يمكنك اعتماده أو إعادته كمسودة." : "سيقوم مدير المكتب بمراجعته."}
              </Alert>
            )}
            {c.status === "TERMINATED" && (
              <Alert tone="danger" title={`أُنهي العقد في ${date(c.terminationDate)}`}>
                {c.terminationReason}
                {c.finalSettlement && <div className="mt-1 text-[12.5px]">التسوية: {c.finalSettlement}</div>}
              </Alert>
            )}
            {c.status === "RENEWED" && renewal && (
              <Alert tone="success" title="تم التجديد">
                العقد الجديد:{" "}
                <Link href={`/contracts/${renewal.id}`} className="link latin">
                  {renewal.code}
                </Link>{" "}
                · {date(renewal.startDate)} ← {date(renewal.endDate)} · {money(renewal.totalAmount)} ر.س
              </Alert>
            )}
            <Card title="الأطراف">
              <div className="grid gap-4 md:grid-cols-3">
                <Party label="المستأجر" name={c.tenant.name} href={`/tenants/${c.tenant.id}`} lines={[c.tenant.phone, c.tenant.nationalId ? `هوية: ${c.tenant.nationalId}` : null, c.tenant.email]} />
                <Party label="المالك" name={c.owner.name} href={`/owners/${c.owner.id}`} lines={[c.owner.phone, `أتعاب الإدارة ${c.managementFeePct}%`]} />
                <Party label="الوحدة" name={`${c.unit.number} — ${c.property.name}`} href={`/units/${c.unit.id}`} lines={[UNIT_TYPES[c.unit.type] ?? c.unit.type, c.unit.floor ? `الدور ${c.unit.floor}` : null, c.unit.area ? `${c.unit.area} م²` : null]} />
              </div>
            </Card>
            <Card title="شروط العقد">
              <DL
                cols={3}
                items={[
                  { label: "المدة", value: `${Math.round((c.endDate.getTime() - c.startDate.getTime()) / (30.4375 * 86400000))} شهر` },
                  { label: "قيمة العقد", value: <span className="num">{money(c.totalAmount)} ر.س</span> },
                  { label: "الإيجار السنوي", value: <span className="num">{money(annualRent(c.totalAmount, contractMonths(c.startDate, c.endDate)))} ر.س</span> },
                  { label: "ضريبة القيمة المضافة", value: <span className="num">{money(c.vatAmount)} ر.س</span> },
                  { label: "دورية السداد", value: PAYMENT_FREQUENCY[c.paymentFrequency] },
                  { label: "عدد الأقساط", value: c.installmentsCount },
                  { label: "أتعاب الإدارة", value: <span className="num">{c.managementFeePct}% ≈ {money((c.totalAmount * c.managementFeePct) / 100)} ر.س</span> },
                  { label: "أنشأه", value: c.createdBy?.name },
                  { label: "تاريخ الإنشاء", value: datetime(c.createdAt) },
                  { label: "مجدد من", value: renewedFrom ? <Link href={`/contracts/${renewedFrom.id}`} className="link latin">{renewedFrom.code}</Link> : null },
                ]}
              />
              {c.notes && <p className="mt-4 whitespace-pre-line rounded-xl bg-mist px-4 py-3 text-[13px] text-text-2">{c.notes}</p>}
            </Card>
          </div>
          <div className="space-y-4">
            <Card title="الأقساط القادمة" actions={c.installments.length ? <Link href={`/contracts/${c.id}?tab=installments`} className="link text-xs">كل الأقساط</Link> : undefined}>
              {schedule.filter((i) => !["PAID", "WAIVED"].includes(i.status)).slice(0, 4).map((i) => (
                <div key={i.id} className="flex items-center justify-between border-b border-[#EDF1EF] py-2 text-[13px] last:border-0">
                  <span>
                    <span className="num">#{i.seq}</span> · {date(i.dueDate)}
                  </span>
                  <span className="flex items-center gap-2">
                    <b className="num">{money(i.amount - i.paidAmount)}</b>
                    <StatusTag value={i.status} map={INSTALLMENT_STATUS} />
                  </span>
                </div>
              ))}
              {schedule.every((i) => ["PAID", "WAIVED"].includes(i.status)) && <p className="text-[13px] text-muted">لا توجد أقساط متبقية.</p>}
            </Card>
            <Card title="ملخص السداد" tone="dark">
              <KV k="إجمالي المستحق" v={<span className="num">{money(totalDue)}</span>} />
              <KV k="المحصل" v={<span className="num">{money(paid)}</span>} />
              <KV k="المتبقي" v={<b className="num text-xl text-sand-200">{money(remaining)}</b>} />
              <KV k="المتأخر" v={<span className={`num ${overdueAmt > 0 ? "text-[#F3B8B8]" : ""}`}>{money(overdueAmt)}</span>} />
              <div className="mt-3">
                <Progress value={progress} tone="sand" />
                <div className="mt-1 text-[11.5px] text-[#BCCBC5]">نسبة التحصيل {pct(progress)}</div>
              </div>
            </Card>
            {c.status === "PENDING_APPROVAL" && approve && manage && (
              <Optional title="رفض الاعتماد">
                <form action={rejectContract} className="space-y-2">
                  <input type="hidden" name="id" value={c.id} />
                  <Field label="سبب الرفض" name="reason">
                    <Input name="reason" placeholder="يُعاد العقد كمسودة" />
                  </Field>
                  <button type="submit" className="btn btn-danger-soft btn-sm">
                    رفض الاعتماد
                  </button>
                </form>
              </Optional>
            )}
          </div>
        </div>
      )}

      {tab === "installments" && (
        <Card padded={false} title={c.installments.length ? `جدول الأقساط (${c.installments.length})` : "جدول الأقساط المتوقع"} subtitle={c.installments.length ? undefined : "يُنشأ الجدول الفعلي عند تفعيل العقد"} actions={c.installments.length ? <Link href={`/installments?contractId=${c.id}`} className="link text-xs">في صفحة الأقساط</Link> : undefined}>
          <Table>
            <thead>
              <tr>
                <th className="num">#</th>
                <th>الاستحقاق</th>
                <th className="num">المبلغ</th>
                <th className="num">المدفوع</th>
                <th className="num">المتبقي</th>
                <th>الحالة</th>
                <th>المطالبة</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {schedule.map((i) => {
                const rem = i.amount - i.paidAmount;
                const late = daysOverdue(i.dueDate);
                const real = !String(i.id).startsWith("p");
                return (
                  <tr key={i.id}>
                    <td className="num">{i.seq}</td>
                    <td>
                      {date(i.dueDate)}
                      {real && !["PAID", "WAIVED"].includes(i.status) && late > 0 && <div className="cell-sub text-danger">متأخر {late} يوم</div>}
                    </td>
                    <td className="num">{money(i.amount, { decimals: true })}</td>
                    <td className="num text-success">{money(i.paidAmount, { decimals: true })}</td>
                    <td className={`num font-semibold ${rem > 0 && late > 0 ? "text-danger" : ""}`}>{money(i.status === "WAIVED" ? 0 : rem, { decimals: true })}</td>
                    <td>
                      <StatusTag value={i.status} map={INSTALLMENT_STATUS} />
                      {i.status === "WAIVED" && i.waivedReason && <div className="cell-sub">{i.waivedReason}</div>}
                    </td>
                    <td>{i.collectionCase ? <Link href={`/collections/${i.collectionCase.id}`} className="link text-xs">فتح المطالبة</Link> : <span className="text-faint">—</span>}</td>
                    <td className="text-left">
                      {real && (
                        <span className="flex justify-end gap-1">
                          <Link href={`/installments/${i.id}`} className="btn btn-ghost btn-xs">
                            التفاصيل
                          </Link>
                          {can(user, "payments.manage") && rem > 0 && i.status !== "WAIVED" && (
                            <Link href={`/payments/new?installmentId=${i.id}&tenantId=${c.tenant.id}`} className="btn btn-outline btn-xs">
                              تسجيل دفعة
                            </Link>
                          )}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </Card>
      )}

      {tab === "payments" && <PaymentsTab contractId={c.id} tenantId={c.tenant.id} canRecord={can(user, "payments.manage") && open} />}

      {tab === "renewal" && (
        <div className="grid gap-4 xl:grid-cols-3">
          <Card title="حالة التجديد" className="xl:col-span-1">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-[13px] text-muted">الحالة الحالية</span>
              <StatusTag value={c.renewalStatus} map={RENEWAL_STATUS} />
            </div>
            <div className="mb-3">
              <KV k="ينتهي في" v={date(c.endDate)} />
              <KV k="المتبقي" v={<span className={`num ${left <= 30 ? "text-danger" : ""}`}>{left} يوم</span>} />
            </div>
            {manage && open ? (
              <form action={setRenewalStatus} className="space-y-2">
                <input type="hidden" name="id" value={c.id} />
                <Field label="تحديث حالة التجديد" name="renewalStatus">
                  <Select name="renewalStatus" options={RENEWAL_STATUS} defaultValue={c.renewalStatus ?? "NO_RESPONSE"} />
                </Field>
                <button type="submit" className="btn btn-outline btn-sm">
                  حفظ الحالة
                </button>
              </form>
            ) : (
              <p className="text-[12.5px] text-muted">متاح للعقود النشطة فقط.</p>
            )}
          </Card>
          <Card title="تجديد العقد" subtitle="ينشئ عقدًا جديدًا بنفس الأطراف." className="xl:col-span-2">
            {renewal ? (
              <Alert tone="success" title="يوجد عقد تجديد">
                <Link href={`/contracts/${renewal.id}`} className="link latin">
                  {renewal.code}
                </Link>{" "}
                · <StatusTag value={renewal.status} map={CONTRACT_STATUS} /> · {date(renewal.startDate)} ← {date(renewal.endDate)} · {money(renewal.totalAmount)} ر.س
              </Alert>
            ) : manage && (open || c.status === "EXPIRED") ? (
              <RenewalForm action={renewContract} contractId={c.id} defaultStart={inputDate(addDays(c.endDate, 1))} currentAnnual={annualRent(c.totalAmount, contractMonths(c.startDate, c.endDate))} frequency={c.paymentFrequency} canApprove={approve} />
            ) : (
              <p className="text-[13px] text-muted">التجديد متاح للعقود النشطة أو المنتهية فقط.</p>
            )}
          </Card>
        </div>
      )}

      {tab === "termination" && (
        <div className="grid gap-4 xl:grid-cols-3">
          <Card title="إنهاء العقد" subtitle="إنهاء مبكر أو إخلاء." className="xl:col-span-2">
            {c.status === "TERMINATED" ? (
              <DL
                cols={2}
                items={[
                  { label: "تاريخ الإنهاء", value: date(c.terminationDate) },
                  { label: "السبب", value: c.terminationReason },
                  { label: "التسوية النهائية", value: c.finalSettlement },
                ]}
              />
            ) : manage && (open || c.status === "EXPIRED") ? (
              <TerminationForm action={terminateContract} contractId={c.id} unpaidCount={unpaid.length} unpaidAmount={unpaidAmt} canApprove={approve} today={inputDate(new Date())} />
            ) : (
              <p className="text-[13px] text-muted">الإنهاء متاح للعقود النشطة فقط. المسودات تُلغى من قائمة «المزيد».</p>
            )}
          </Card>
          <Card title="الوضع المالي قبل الإنهاء">
            <KV k="أقساط غير مسددة (مستحقة)" v={<span className={`num ${unpaid.length ? "text-danger" : ""}`}>{unpaid.length}</span>} />
            <KV k="قيمتها" v={<span className="num">{money(unpaidAmt)}</span>} />
            <KV k="أقساط مستقبلية ستُعفى" v={<span className="num">{c.installments.filter((i) => !["PAID", "WAIVED"].includes(i.status) && i.dueDate > new Date()).length}</span>} />
          </Card>
        </div>
      )}

      {tab === "documents" && <DocumentsTab contractId={c.id} code={c.code} canManage={can(user, "documents.manage")} />}
      {tab === "activity" && <ActivityTab contractId={c.id} />}
    </>
  );
}

/* ───────── bits ───────── */

function Party({ label, name, href, lines }: { label: string; name: string; href: string; lines: (string | null | undefined)[] }) {
  return (
    <div className="rounded-xl bg-mist px-4 py-3">
      <div className="text-[11.5px] font-semibold text-muted">{label}</div>
      <Link href={href} className="text-[14.5px] font-bold text-text hover:text-brand">
        {name}
      </Link>
      {lines.filter(Boolean).map((l, i) => (
        <div key={i} className="latin text-[12.5px] text-text-2">
          {l}
        </div>
      ))}
    </div>
  );
}

async function PaymentsTab({ contractId, tenantId, canRecord }: { contractId: string; tenantId: string; canRecord: boolean }) {
  const rows = await db.payment.findMany({
    where: { OR: [{ contractId }, { allocations: { some: { installment: { contractId } } } }] },
    orderBy: { paidAt: "desc" },
    include: { allocations: { where: { installment: { contractId } }, include: { installment: { select: { seq: true } } } }, recordedBy: { select: { name: true } } },
  });
  const total = rows.filter((p) => ["RECORDED", "APPROVED"].includes(p.status)).reduce((s, p) => s + p.amount, 0);
  return (
    <Card padded={false} title={`سندات القبض (${rows.length})`} subtitle={`الإجمالي: ${money(total)} ر.س`} actions={canRecord ? <Link href={`/payments/new?tenantId=${tenantId}&contractId=${contractId}`} className="btn btn-primary btn-sm">تسجيل دفعة</Link> : undefined}>
      {rows.length === 0 ? (
        <EmptyState title="لا توجد مدفوعات" description="سجّل أول دفعة لتُخصم من الأقساط تلقائيًا." />
      ) : (
        <Table>
          <thead>
            <tr>
              <th>الدفعة</th>
              <th>التاريخ</th>
              <th className="num">المبلغ</th>
              <th>الطريقة</th>
              <th>المرجع</th>
              <th>الأقساط</th>
              <th>سجلها</th>
              <th>الحالة</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id}>
                <td>
                  <Link href={`/payments/${p.id}`} className="cell-primary latin hover:text-brand">
                    {p.code}
                  </Link>
                </td>
                <td>{date(p.paidAt)}</td>
                <td className="num font-semibold">{money(p.amount, { decimals: true })}</td>
                <td>{PAYMENT_METHODS[p.method] ?? p.method}</td>
                <td className="latin text-muted">{p.reference ?? "—"}</td>
                <td className="num text-muted">{p.allocations.map((a) => `#${a.installment.seq}`).join("، ") || "—"}</td>
                <td className="text-muted">{p.recordedBy?.name ?? "—"}</td>
                <td>
                  <StatusTag value={p.status} map={PAYMENT_STATUS} />
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

async function DocumentsTab({ contractId, code, canManage }: { contractId: string; code: string; canManage: boolean }) {
  const rows = await db.document.findMany({ where: { entityType: "CONTRACT", entityId: contractId }, orderBy: { createdAt: "desc" } });
  return (
    <Card padded={false} title="المستندات" actions={canManage ? <Link href={`/documents/new?entityType=CONTRACT&entityId=${contractId}&entityLabel=${encodeURIComponent(code)}`} className="btn btn-primary btn-sm">إضافة مستند</Link> : undefined}>
      {rows.length === 0 ? (
        <EmptyState title="لا توجد مستندات" description="ارفع نسخة العقد الموقعة، هوية المستأجر، وسند التأمين." />
      ) : (
        <Table>
          <thead>
            <tr>
              <th>المستند</th>
              <th>النوع</th>
              <th>الإصدار</th>
              <th>الانتهاء</th>
              <th className="num">النسخة</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.id}>
                <td>
                  <Link href={`/documents/${d.id}`} className="cell-primary hover:text-brand">
                    {d.name}
                  </Link>
                </td>
                <td>{DOCUMENT_TYPES[d.type] ?? d.type}</td>
                <td>{date(d.issueDate)}</td>
                <td>{date(d.expiryDate)}</td>
                <td className="num">v{d.version}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

async function ActivityTab({ contractId }: { contractId: string }) {
  const rows = await db.auditLog.findMany({ where: { entityType: "CONTRACT", entityId: contractId }, orderBy: { createdAt: "desc" }, take: 60 });
  return (
    <Card title="سجل العمليات">
      {rows.length === 0 ? (
        <EmptyState title="لا توجد عمليات مسجلة" />
      ) : (
        <div className="timeline">
          {rows.map((a) => (
            <div key={a.id} className={`timeline-item ${a.action === "REJECT" ? "danger" : a.action === "SYNC" ? "neutral" : ""}`}>
              <div className="text-[13px]">
                <StatusTag value={a.action} map={AUDIT_ACTIONS} /> <b>{a.userName}</b>
                {a.newValue && <span className="text-muted"> — {summarize(a.newValue)}</span>}
              </div>
              <div className="text-[11.5px] text-faint">{datetime(a.createdAt)}</div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function summarize(s: string) {
  try {
    const v = JSON.parse(s) as Record<string, unknown>;
    const parts: string[] = [];
    if (typeof v.status === "string") parts.push(CONTRACT_STATUS[v.status]?.label ?? v.status);
    if (typeof v.renewalStatus === "string") parts.push(`التجديد: ${RENEWAL_STATUS[v.renewalStatus]?.label ?? v.renewalStatus}`);
    if (typeof v.override === "string") parts.push(`تجاوز ${v.override}`);
    if (typeof v.reason === "string" && v.reason) parts.push(v.reason);
    if (typeof v.provider === "string") parts.push(v.provider);
    return parts.join(" · ").slice(0, 140);
  } catch {
    return s.slice(0, 80);
  }
}
