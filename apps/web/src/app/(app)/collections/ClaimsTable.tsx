"use client";

import Link from "next/link";
import { useState } from "react";
import type { ClaimRow } from "@/lib/collections";
import { COLLECTION_STATUS, INSTALLMENT_STATUS, COLLECTION_ACTION_TYPES, RISK_LEVELS, NOTIFICATION_CHANNELS } from "@/lib/constants";
import { money, date, relative, inputDate } from "@/lib/format";
import { Table, StatusTag, Tag, PriorityPill, EmptyState, ActionButton, Drawer, KV } from "@/components/ui";
import { CaseActions } from "./[id]/CaseActions";
import { sendTemplate } from "./actions";
import { ReminderComposer } from "./ReminderComposer";
import { displayPhone, telHref } from "@/lib/phone";

type Opt = { id: string; name: string };
export type TemplateOpt = { id: string; name: string; channel: string; body: string };

/** Renders {{tenant_name}} … placeholders client-side for the preview. */
function fill(body: string, c: ClaimRow) {
  const vars: Record<string, string> = { tenant_name: c.tenantName, unit_number: c.unitNumber, amount: money(c.remaining), due_date: date(c.dueDate), contract_code: c.contractCode };
  return body.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, k: string) => vars[k] ?? "");
}

/**
 * Claims of one property. Every row opens a side drawer with the full follow-up toolbox (same server actions as
 * the case page), so the office never leaves the property.
 */
export function ClaimsTable({ rows, collectors, templates, canManage, canPay, emptyHint }: { rows: ClaimRow[]; collectors: Opt[]; templates: TemplateOpt[]; canManage: boolean; canPay: boolean; emptyHint?: string }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const open = rows.find((r) => r.installmentId === openId) ?? null;

  if (rows.length === 0) return <EmptyState title="لا توجد مطالبات مفتوحة" description={emptyHint ?? "كل الدفعات المستحقة على هذا العقار مسددة."} />;

  return (
    <>
      <Table density="compact">
        <thead>
          <tr>
            <th>المستأجر</th>
            <th className="num">المتبقي</th>
            <th>التأخر</th>
            <th>الحالة</th>
            <th>المتابعة</th>
            <th>مؤشر التأخر</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => {
            const promiseLate = c.promiseDate && new Date(c.promiseDate) < new Date() && c.followUpStatus === "PROMISE_TO_PAY";
            return (
              <tr key={c.installmentId} className={openId === c.installmentId ? "row-active" : ""}>
                <td>
                  <button type="button" onClick={() => setOpenId(c.installmentId)} className="cell-primary text-right hover:text-brand">
                    {c.tenantName}
                  </button>
                  <div className="cell-sub">
                    وحدة <span className="latin">{c.unitNumber}</span> · دفعة <span className="num">{c.seq}</span> · <span className="latin">{c.contractCode}</span>
                  </div>
                </td>
                <td className="num font-bold">
                  {money(c.remaining)}
                  {c.paidAmount > 0 && <div className="cell-sub num">من {money(c.amount)}</div>}
                </td>
                <td>
                  {c.late > 0 ? (
                    <>
                      <span className={`num ${c.late > c.graceDays ? "font-bold text-danger" : ""}`}>{c.late}</span> يوم
                      <div className="cell-sub">{c.enforceable ? <span className="text-warning">تجاوزت مهلة السداد</span> : `ضمن المهلة (${c.graceDays} يوم)`}</div>
                    </>
                  ) : (
                    <>
                      <span className="text-muted">يستحق اليوم</span>
                      <div className="cell-sub">{date(c.dueDate)}</div>
                    </>
                  )}
                </td>
                <td>
                  {c.followUpStatus ? <StatusTag value={c.followUpStatus} map={COLLECTION_STATUS} /> : <StatusTag value={c.status} map={INSTALLMENT_STATUS} />}
                  {c.promiseDate && (
                    <div className={`cell-sub ${promiseLate ? "text-danger" : ""}`}>
                      وعد {date(c.promiseDate)}
                      {c.promiseAmount ? <span className="num"> · {money(c.promiseAmount)}</span> : null}
                    </div>
                  )}
                </td>
                <td className="text-[12.5px]">
                  {c.collectorName ?? <Tag tone="warning" plain>بلا محصل</Tag>}
                  <div className="cell-sub">{c.lastAction ? `${COLLECTION_ACTION_TYPES[c.lastAction.type] ?? c.lastAction.type} · ${relative(c.lastAction.at)}` : c.caseId ? "لا يوجد إجراء بعد" : "تُفتح المطالبة تلقائيًا"}</div>
                </td>
                <td>
                  <StatusTag value={c.risk.level} map={RISK_LEVELS} />
                  <div className="cell-sub">{c.risk.reasons[0]}</div>
                </td>
                <td className="num">
                  <div className="flex items-center justify-end gap-1">
                    {c.caseId && <PriorityPill v={c.priority} />}
                    <button type="button" onClick={() => setOpenId(c.installmentId)} className="btn btn-outline btn-xs">
                      متابعة
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </Table>

      <Drawer open={!!open} onClose={() => setOpenId(null)} title={open ? open.tenantName : ""}>
        {open && (
          <div className="space-y-4">
            <div className="rounded-xl bg-mist px-4 py-3 text-[13px]">
              <KV k="المتبقي" v={<b className="num text-danger">{money(open.remaining)} ر.س</b>} />
              <KV k="الاستحقاق" v={<span>{date(open.dueDate)}{open.late > 0 ? ` · متأخر ${open.late} يوم` : ""}</span>} />
              <KV k="مهلة السداد" v={open.enforceable ? <span className="text-warning">انتهت — يمكن تقديم طلب تنفيذ مالي عبر ناجز</span> : <span>{open.graceDays} يوم من الاستحقاق</span>} />
              <KV k="مؤشر التأخر" v={<span><StatusTag value={open.risk.level} map={RISK_LEVELS} /> <span className="text-muted">{open.risk.reasons.join("، ")}</span></span>} />
              {open.phone && <KV k="الجوال" v={<a href={telHref(open.phone)} className="link num">{displayPhone(open.phone)}</a>} />}
            </div>

            <div className="flex flex-wrap gap-2">
              {canPay && (
                <Link href={`/payments/new?installmentId=${open.installmentId}&tenantId=${open.tenantId}`} className="btn btn-primary btn-sm">
                  تسجيل سند قبض
                </Link>
              )}
              <Link href={`/tenants/${open.tenantId}`} className="btn btn-outline btn-sm">
                ملف المستأجر
              </Link>
              {open.caseId && (
                <Link href={`/collections/${open.caseId}`} className="btn btn-ghost btn-sm">
                  صفحة المطالبة
                </Link>
              )}
              <Link href={`/contracts/${open.contractId}`} className="btn btn-ghost btn-sm">
                العقد
              </Link>
            </div>

            {open.caseId ? (
              <>
                <div>
                  <div className="mb-2 text-[13px] font-bold text-text">إجراءات المتابعة</div>
                  <CaseActions
                    key={open.caseId}
                    caseId={open.caseId}
                    remaining={open.remaining}
                    followUpStatus={open.followUpStatus ?? "OPEN"}
                    installmentStatus={open.status}
                    collectors={collectors}
                    collectorId={open.collectorId}
                    nextAction={open.nextAction}
                    nextActionDate={inputDate(open.nextActionDate)}
                    promiseAmount={open.promiseAmount}
                    promiseDate={inputDate(open.promiseDate)}
                    canManage={canManage}
                    enforceable={open.enforceable}
                  />
                </div>

                <div>
                  <div className="mb-2 text-[13px] font-bold text-text">إرسال تذكير</div>
                  {canManage && !["PAID", "CLOSED"].includes(open.followUpStatus ?? "") && <ReminderComposer key={open.caseId} caseId={open.caseId} hasPhone={Boolean(open.phone)} hasEmail={Boolean(open.email)} />}
                </div>
                {templates.length > 0 && (
                  <div>
                    <div className="mb-2 text-[13px] font-bold text-text">قوالب المكتب</div>
                    <div className="space-y-2">
                      {templates.map((t) => (
                        <div key={t.id} className="rounded-xl border border-line p-3">
                          <div className="flex items-center justify-between gap-2">
                            <b className="text-[13px]">{t.name}</b>
                            <Tag tone="info" plain>
                              {NOTIFICATION_CHANNELS[t.channel] ?? t.channel}
                            </Tag>
                          </div>
                          <p className="mt-1.5 whitespace-pre-line text-[12.5px] text-text-2">{fill(t.body, open)}</p>
                          {canManage && (
                            <div className="mt-2">
                              <ActionButton action={sendTemplate} hidden={{ caseId: open.caseId ?? "", templateId: t.id }} className="btn btn-outline btn-xs" confirm="إرسال هذه الرسالة للمستأجر الآن؟">
                                إرسال
                              </ActionButton>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <p className="rounded-xl border border-line px-4 py-3 text-[13px] text-muted">الدفعة مستحقة اليوم. تُفتح المطالبة تلقائيًا عند مرور تاريخ الاستحقاق دون سداد.</p>
            )}
          </div>
        )}
      </Drawer>
    </>
  );
}
