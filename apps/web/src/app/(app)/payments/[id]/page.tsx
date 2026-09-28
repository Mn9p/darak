import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { can, contractScope } from "@/lib/permissions";
import { PAYMENT_METHODS, PAYMENT_STATUS, RECONCILIATION_STATUS, INSTALLMENT_STATUS, AUDIT_ACTIONS } from "@/lib/constants";
import { money, date, datetime } from "@/lib/format";
import { HeroHeader, Card, Table, StatusTag, DL, EmptyState, ActionButton, Alert, KV, Input, Field } from "@/components/ui";
import { MoreMenu, Optional } from "@/components/MoreMenu";
import { approvePayment, reversePayment, markReturnedCheque } from "../actions";
import { AllocateForm } from "./AllocateForm";
import { PrintButton } from "./PrintButton";
import { PrintHeader, PrintStyles } from "@/components/PrintHeader";
import { displayPhone } from "@/lib/phone";

export const dynamic = "force-dynamic";

export default async function PaymentPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireStaff();
  const { id } = await params;
  const org = user.organizationId;

  const p = await db.payment.findFirst({
    where: { id, organizationId: org, ...contractScope(user) },
    include: {
      tenant: { select: { id: true, name: true, phone: true, code: true } },
      contract: { select: { id: true, code: true, unit: { select: { id: true, number: true } }, property: { select: { id: true, name: true } } } },
      allocations: {
        orderBy: { createdAt: "asc" },
        include: { installment: { select: { id: true, seq: true, dueDate: true, amount: true, paidAmount: true, status: true, contract: { select: { id: true, code: true, unit: { select: { number: true } } } }, collectionCase: { select: { id: true } } } } },
      },
      bankTxn: true,
      recordedBy: { select: { name: true } },
    },
  });
  if (!p) notFound();

  const allocated = p.allocations.reduce((s, a) => s + a.amount, 0);
  const unallocated = Math.round((p.amount - allocated) * 100) / 100;
  const inactive = ["REVERSED", "RETURNED"].includes(p.status);
  const canApprove = can(user, "payments.approve");
  const canAllocate = can(user, "payments.manage") && !inactive && unallocated > 0.009 && (p.status !== "APPROVED" || canApprove);

  const [openInstallments, logs] = await Promise.all([
    canAllocate
      ? db.installment.findMany({
          where: { organizationId: org, tenantId: p.tenantId, status: { notIn: ["PAID", "WAIVED"] }, id: { notIn: p.allocations.map((a) => a.installmentId) }, ...contractScope(user) },
          orderBy: { dueDate: "asc" },
          select: { id: true, seq: true, dueDate: true, amount: true, paidAmount: true, contract: { select: { code: true, unit: { select: { number: true } } } } },
        })
      : Promise.resolve([]),
    db.auditLog.findMany({ where: { organizationId: org, entityType: "PAYMENT", entityId: p.id }, orderBy: { createdAt: "desc" }, take: 20 }),
  ]);

  return (
    <>
      <PrintStyles />
      <div className="no-print">
        <HeroHeader
          title={
            <span>
              <span className="num">{money(p.amount)}</span> <span className="text-[15px] font-semibold text-muted">ر.س</span>
            </span>
          }
          code={p.code}
          status={
            <>
              <StatusTag value={p.status} map={PAYMENT_STATUS} />
              <StatusTag value={p.reconciliationStatus} map={RECONCILIATION_STATUS} />
            </>
          }
          meta={[
            <span key="tenant">
              من <Link href={`/tenants/${p.tenant.id}`} className="link">{p.tenant.name}</Link>
            </span>,
            <span key="date" className="latin">{date(p.paidAt)}</span>,
            <span key="method">{PAYMENT_METHODS[p.method] ?? p.method}{p.reference ? ` — ${p.reference}` : ""}</span>,
            p.contract && (
              <span key="contract">
                العقد <Link href={`/contracts/${p.contract.id}`} className="link latin">{p.contract.code}</Link>
              </span>
            ),
          ]}
          breadcrumbs={[{ label: "سندات القبض", href: "/payments" }, { label: p.code }]}
          actions={
            <>
              {canApprove && p.status === "RECORDED" && (
                <ActionButton action={approvePayment} hidden={{ id: p.id }} className="btn btn-primary btn-sm">
                  اعتماد السند
                </ActionButton>
              )}
              <PrintButton />
              <MoreMenu
                items={[
                  { label: "ملف المستأجر", href: `/tenants/${p.tenant.id}` },
                  p.contract ? { label: "العقد", href: `/contracts/${p.contract.id}` } : null,
                  { label: "كل دفعات المستأجر", href: `/payments?q=${encodeURIComponent(p.tenant.name)}` },
                  p.attachmentUrl ? { label: "عرض الإيصال المرفق", href: p.attachmentUrl } : null,
                  canApprove && !p.bankTxn ? { label: "المطابقة البنكية", href: "/reconciliation?tab=UNMATCHED" } : null,
                ]}
              />
            </>
          }
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          {/* Printable receipt */}
          <Card className="print-sheet">
            <PrintHeader orgName={user.organizationName ?? ""} title="سند قبض" code={p.code} date={date(p.paidAt)} extra={<StatusTag value={p.status} map={PAYMENT_STATUS} />} />
            <div className="grid gap-4 md:grid-cols-2">
              <DL
                cols={1}
                items={[
                  { label: "استلمنا من", value: <Link href={`/tenants/${p.tenant.id}`} className="link">{p.tenant.name}</Link> },
                  { label: "رقم المستأجر", value: <span className="latin">{p.tenant.code}</span> },
                  { label: "الجوال", value: p.tenant.phone ? <span className="num">{displayPhone(p.tenant.phone)}</span> : null },
                ]}
              />
              <DL
                cols={1}
                items={[
                  { label: "العقد", value: p.contract ? <Link href={`/contracts/${p.contract.id}`} className="link latin">{p.contract.code}</Link> : null },
                  { label: "الوحدة / العقار", value: p.contract ? <span><Link href={`/units/${p.contract.unit.id}`} className="link latin">{p.contract.unit.number}</Link> · {p.contract.property.name}</span> : null },
                  { label: "طريقة الدفع", value: `${PAYMENT_METHODS[p.method] ?? p.method}${p.bank ? ` — ${p.bank}` : ""}${p.reference ? ` — ${p.reference}` : ""}` },
                ]}
              />
            </div>
            <div className="mt-4 flex items-center justify-between rounded-xl bg-mist px-4 py-3">
              <span className="text-[13px] font-bold text-muted">المبلغ المستلم</span>
              <b className={`num text-2xl text-brand ${inactive ? "line-through" : ""}`}>{money(p.amount, { decimals: true })} ر.س</b>
            </div>
            {inactive && (
              <div className="mt-3">
                <Alert tone="danger" title={p.status === "REVERSED" ? "سند معكوس" : "شيك مرتجع"}>
                  هذا السند لم يعد ساريًا ولا يُحتسب ضمن المسدد.
                </Alert>
              </div>
            )}
            <div className="mt-4">
              <div className="mb-2 text-[12.5px] font-bold text-muted">التخصيص على الأقساط</div>
              {p.allocations.length === 0 ? (
                <p className="text-[13px] text-muted">لم يُخصَّص هذا السند على أي دفعة بعد — محفوظ كرصيد دائن.</p>
              ) : (
                <Table>
                  <thead>
                    <tr>
                      <th>العقد / الوحدة</th>
                      <th className="num">القسط</th>
                      <th>الاستحقاق</th>
                      <th className="num">المخصص</th>
                      <th>حالة القسط</th>
                    </tr>
                  </thead>
                  <tbody>
                    {p.allocations.map((a) => (
                      <tr key={a.id}>
                        <td>
                          <Link href={`/contracts/${a.installment.contract.id}`} className="latin hover:text-brand">
                            {a.installment.contract.code}
                          </Link>
                          <div className="cell-sub latin">{a.installment.contract.unit.number}</div>
                        </td>
                        <td className="num">
                          <Link href={`/installments/${a.installment.id}`} className="hover:text-brand">
                            {a.installment.seq}
                          </Link>
                          {a.installment.collectionCase && (
                            <Link href={`/collections/${a.installment.collectionCase.id}`} className="no-print cell-sub link">
                              المطالبة
                            </Link>
                          )}
                        </td>
                        <td>{date(a.installment.dueDate)}</td>
                        <td className="num font-semibold">{money(a.amount, { decimals: true })}</td>
                        <td>
                          <StatusTag value={a.installment.status} map={INSTALLMENT_STATUS} />
                        </td>
                      </tr>
                    ))}
                    <tr>
                      <td colSpan={3} className="font-bold">
                        الإجمالي المخصص / غير المخصص
                      </td>
                      <td className="num font-bold" colSpan={2}>
                        {money(allocated, { decimals: true })} / <span className={unallocated > 0.009 ? "text-warning" : ""}>{money(Math.max(0, unallocated), { decimals: true })}</span>
                      </td>
                    </tr>
                  </tbody>
                </Table>
              )}
            </div>
            {p.notes && <p className="mt-4 whitespace-pre-line rounded-xl bg-mist px-4 py-3 text-[13px] text-text-2">{p.notes}</p>}
            {p.attachmentUrl && (
              <div className="no-print mt-4 flex items-center justify-between gap-3 rounded-xl border border-line px-4 py-2.5 text-[13px]">
                <span className="flex items-center gap-2">
                  <span className="grid h-8 w-8 place-items-center rounded-lg bg-mist"></span>
                  <span>
                    <b>إيصال / إثبات التحويل</b>
                    <span className="block text-[11.5px] text-muted">مرفق خاص — يُعرض لمستخدمي المكتب فقط</span>
                  </span>
                </span>
                <a href={p.attachmentUrl} target="_blank" rel="noreferrer" className="btn btn-outline btn-xs">
                  عرض المرفق
                </a>
              </div>
            )}
            <div className="mt-6 flex items-end justify-between border-t border-line pt-4 text-[12px] text-muted">
              <span>سجلها: {p.recordedBy?.name ?? "—"} · {datetime(p.createdAt)}</span>
              <span className="border-t border-dashed border-line pt-1">التوقيع والختم</span>
            </div>
          </Card>

          {canAllocate && (
            <Card title="تخصيص الرصيد غير المخصص" subtitle={`${money(unallocated)} ر.س بانتظار التخصيص`} className="no-print">
              {openInstallments.length === 0 ? (
                <p className="text-[13px] text-muted">لا توجد أقساط مفتوحة أخرى لهذا المستأجر. سيبقى المبلغ رصيدًا دائنًا.</p>
              ) : (
                <AllocateForm
                  paymentId={p.id}
                  available={unallocated}
                  rows={openInstallments.map((i) => ({ id: i.id, contractCode: i.contract.code, unitNumber: i.contract.unit.number, seq: i.seq, dueLabel: date(i.dueDate), remaining: Math.round((i.amount - i.paidAmount) * 100) / 100 }))}
                />
              )}
            </Card>
          )}

          <Card title="سجل العمليات" className="no-print">
            {logs.length === 0 ? (
              <EmptyState title="لا توجد عمليات مسجلة" />
            ) : (
              <div className="timeline">
                {logs.map((a) => (
                  <div key={a.id} className={`timeline-item ${a.action === "STATUS_CHANGE" ? "danger" : ""}`}>
                    <div className="text-[13px]">
                      <StatusTag value={a.action} map={AUDIT_ACTIONS} /> <b>{a.userName}</b>
                    </div>
                    <div className="text-[11.5px] text-faint">{datetime(a.createdAt)}</div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        <div className="no-print space-y-4">
          <Card title="المطابقة البنكية">
            <KV k="الحالة" v={<StatusTag value={p.reconciliationStatus} map={RECONCILIATION_STATUS} />} />
            {p.bankTxn ? (
              <>
                <KV k="حركة البنك" v={<Link href={`/reconciliation?tab=${p.bankTxn.status}&q=${encodeURIComponent(p.bankTxn.reference ?? "")}`} className="link latin">{p.bankTxn.reference ?? p.bankTxn.id.slice(0, 8)}</Link>} />
                <KV k="تاريخ الحركة" v={date(p.bankTxn.date)} />
                <KV k="البنك" v={p.bankTxn.bank ?? "—"} />
              </>
            ) : (
              <p className="mt-2 text-[13px] text-muted">لم تُربط بحركة بنكية بعد.{canApprove && <> <Link href="/reconciliation?tab=UNMATCHED" className="link">فتح المطابقة</Link></>}</p>
            )}
          </Card>

          {canApprove && !inactive && (
            <Optional title="عكس السند">
              <form action={reversePayment} className="space-y-2" data-confirm="عكس السند يلغي تخصيصه على الدفعات ويعيد فتح المطالبات. متابعة؟">
                <input type="hidden" name="id" value={p.id} />
                <Field label="سبب العكس" name="reason" required help="الدفعات لا تُحذف، تُعكس مع سبب مسجَّل.">
                  <Input name="reason" required placeholder="مثال: خطأ في الإدخال أو حوالة مرتدة" />
                </Field>
                <button type="submit" className="btn btn-danger-soft btn-sm w-full">
                  عكس السند
                </button>
              </form>
              {p.method === "CHEQUE" && (
                <form action={markReturnedCheque} className="mt-4 space-y-2 border-t border-line pt-4">
                  <input type="hidden" name="id" value={p.id} />
                  <Field label="سبب ارتجاع الشيك" name="reason">
                    <Input name="reason" placeholder="مثال: رصيد غير كافٍ" />
                  </Field>
                  <button type="submit" className="btn btn-danger btn-sm w-full">
                    تسجيل شيك مرتجع
                  </button>
                </form>
              )}
            </Optional>
          )}
        </div>
      </div>
    </>
  );
}
