import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { computeOwnerStatement, statementFigures } from "@/lib/engine";
import { STATEMENT_STATUS, EXPENSE_CATEGORIES, AUDIT_ACTIONS } from "@/lib/constants";
import { money, date, datetime, monthLabel, inputDate } from "@/lib/format";
import { PageHeader, Card, Table, StatusTag, DL, EmptyState, ActionButton, KV, Alert, Field, Input, Textarea } from "@/components/ui";
import { MoreMenu } from "@/components/MoreMenu";
import { PrintButton } from "../PrintButton";
import { PrintHeader, PrintStyles } from "@/components/PrintHeader";
import { submitStatement, approveStatement, markStatementPaid, closeStatement, backToDraft, updateDeductions } from "../actions";
import { displayPhone } from "@/lib/phone";

export const dynamic = "force-dynamic";

export default async function StatementPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireStaff();
  const { id } = await params;
  const org = user.organizationId;

  const s = await db.ownerStatement.findFirst({
    where: { id, organizationId: org },
    include: {
      owner: { select: { id: true, name: true, code: true, iban: true, bankName: true, managementFeePct: true, phone: true } },
      property: { select: { id: true, name: true } },
      organization: { select: { name: true, crNumber: true, vatNumber: true, phone: true, city: true } },
    },
  });
  if (!s) notFound();

  const [figures, logs] = await Promise.all([
    statementFigures(s),
    db.auditLog.findMany({ where: { entityType: "STATEMENT", entityId: id }, orderBy: { createdAt: "desc" }, take: 30 }),
  ]);

  const canManage = can(user, "statements.manage");
  const canApprove = canManage && ["OFFICE_MANAGER", "ACCOUNTANT", "SUPER_ADMIN"].includes(user.role);
  // Drafts are recomputed live; a locked statement shows its frozen lines (later movements settle in the next statement).
  const drift = s.status === "DRAFT" && (Math.abs(figures.collectedRent - s.collectedRent) > 0.01 || Math.abs(figures.expenses - s.expenses) > 0.01 || Math.abs(figures.managementFees - s.managementFees) > 0.01);
  const paymentLines = [...figures.lines].sort((a, b) => a.date.getTime() - b.date.getTime());

  return (
    <>
      <PrintStyles />
      <div className="no-print">
        <PageHeader
          title={
            <span className="flex flex-wrap items-center gap-2">
              <span>كشف حساب المالك</span> <span className="latin">{s.code}</span> <StatusTag value={s.status} map={STATEMENT_STATUS} />
            </span>
          }
          subtitle={
            <>
              <Link href={`/owners/${s.owner.id}`} className="link">
                {s.owner.name}
              </Link>{" "}
              · {monthLabel(s.periodStart)} · {s.property ? s.property.name : "كل العقارات"}
            </>
          }
          breadcrumbs={[{ label: "كشوف حساب الملاك", href: "/statements" }, { label: s.code }]}
          actions={
            <>
              <PrintButton />
              {canManage && s.status === "DRAFT" && (
                <ActionButton action={submitStatement} hidden={{ id: s.id }} className="btn btn-primary btn-sm">
                  إرسال للمراجعة
                </ActionButton>
              )}
              {canApprove && s.status === "UNDER_REVIEW" && (
                <ActionButton action={approveStatement} hidden={{ id: s.id }} className="btn btn-primary btn-sm">
                  اعتماد كشف الحساب
                </ActionButton>
              )}
              {canManage && s.status === "PAID" && (
                <ActionButton action={closeStatement} hidden={{ id: s.id }} className="btn btn-primary btn-sm">
                  إغلاق كشف الحساب
                </ActionButton>
              )}
              <MoreMenu
                items={[
                  { label: "تسويات المالك", href: `/statements?ownerId=${s.owner.id}` },
                  { label: "صفحة المالك", href: `/owners/${s.owner.id}` },
                  canApprove && s.status === "DRAFT" && { label: "اعتماد مباشر", node: <ActionButton action={approveStatement} hidden={{ id: s.id }} className="btn btn-ghost btn-sm">اعتماد مباشر</ActionButton> },
                  canManage && s.status === "UNDER_REVIEW" && { label: "إعادة إلى مسودة", node: <ActionButton action={backToDraft} hidden={{ id: s.id }} className="btn btn-ghost btn-sm">إعادة إلى مسودة</ActionButton> },
                  canManage && s.status === "APPROVED" && { label: "إغلاق بدون تحويل", node: <ActionButton action={closeStatement} hidden={{ id: s.id }} className="btn btn-ghost btn-sm">إغلاق بدون تحويل</ActionButton> },
                  canManage && s.status === "APPROVED" && { label: "إعادة إلى مسودة", danger: true, node: <ActionButton action={backToDraft} hidden={{ id: s.id }} className="btn btn-ghost btn-sm text-danger" confirm="إعادة كشف الحساب إلى مسودة تلغي الاعتماد وتفك تثبيت أرقامه. هل تريد المتابعة؟">إعادة إلى مسودة</ActionButton> },
                ]}
              />
            </>
          }
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        {/* ───── Printable statement ───── */}
        <div className="xl:col-span-2">
          <Card className="print-sheet" padded>
            <PrintHeader
              orgName={s.organization.name}
              orgMeta={[s.organization.city, s.organization.crNumber ? `س.ت ${s.organization.crNumber}` : null, s.organization.vatNumber ? `الرقم الضريبي ${s.organization.vatNumber}` : null, s.organization.phone].filter(Boolean).join(" · ")}
              title="كشف حساب المالك"
              code={s.code}
              date={`أُصدر ${date(s.createdAt)}`}
              extra={s.status === "DRAFT" ? <span className="text-[11px] font-bold text-warning">مسودة — غير معتمد</span> : undefined}
            />

            <div>
              <DL
                cols={4}
                items={[
                  { label: "المالك", value: <>{s.owner.name} <span className="latin text-xs text-muted">{s.owner.code}</span></> },
                  { label: "الفترة", value: <>{monthLabel(s.periodStart)} <span className="text-xs text-muted">({date(s.periodStart)} → {date(s.periodEnd)})</span></> },
                  { label: "الحالة", value: <StatusTag value={s.status} map={STATEMENT_STATUS} /> },
                  { label: "تاريخ التحويل", value: s.paidAt ? date(s.paidAt) : null },
                  { label: "البنك / IBAN", value: s.owner.iban ? <span className="latin">{[s.owner.bankName, s.owner.iban].filter(Boolean).join(" · ")}</span> : null },
                  { label: "نسبة أتعاب الإدارة", value: <span className="num">{s.owner.managementFeePct}%</span> },
                  { label: "نطاق الكشف", value: s.property ? s.property.name : "كل العقارات" },
                  { label: "الجوال", value: s.owner.phone ? <span className="num">{displayPhone(s.owner.phone)}</span> : null },
                ]}
              />
              <div className="mt-3 text-[12.5px]">
                <span className="font-semibold text-muted">العقارات المشمولة: </span>
                {figures.properties.length ? (
                  figures.properties.map((p, i) => (
                    <span key={`${p.id}-${i}`}>
                      <Link href={`/properties/${p.id}`} className="hover:text-brand">
                        {p.name}
                      </Link>{" "}
                      <span className="num text-muted">({p.pct}%)</span>
                      {i < figures.properties.length - 1 ? "، " : ""}
                    </span>
                  ))
                ) : (
                  <span className="text-faint">—</span>
                )}
              </div>
            </div>

            {/* Formula block */}
            <div className="mt-5 grid gap-2 rounded-2xl bg-mist p-4 sm:grid-cols-5">
              <FormulaCell label="الإيجار المحصل" value={s.collectedRent} />
              <FormulaCell label="− أتعاب الإدارة" value={s.managementFees} negative />
              <FormulaCell label="− المصروفات المعتمدة" value={s.expenses} negative />
              <FormulaCell label="− خصومات أخرى" value={s.otherDeductions} negative />
              <div className="rounded-xl bg-brand px-3 py-2 text-white">
                <div className="text-[11px] opacity-80">= صافي المستحق للمالك</div>
                <div className="num text-lg font-black">{money(s.netDue, { decimals: true })} <span className="text-[11px] font-normal">ر.س</span></div>
              </div>
            </div>
            {s.netDue < 0 && <div className="mt-2"><Alert tone="warning">صافي المستحق سالب — المصروفات والخصومات تتجاوز المحصل خلال الفترة، ويُرحّل الرصيد على المالك.</Alert></div>}
            {drift && (
              <div className="no-print mt-2">
                <Alert tone="info">
                  الأرقام المحفوظة تختلف عن الاحتساب الحالي (المحصل {money(figures.collectedRent)} · المصروفات {money(figures.expenses)}). أعد إنشاء كشف الحساب لنفس الفترة لتحديث الأرقام، وتُثبَّت الأرقام تلقائيًا عند إرساله للمراجعة.
                </Alert>
              </div>
            )}
            {figures.carriedCount > 0 && (
              <div className="mt-2">
                <Alert tone="info">
                  يشمل هذا الكشف <span className="num">{figures.carriedCount}</span> {figures.carriedCount === 1 ? "قيدًا" : "قيود"} من فترات سابقة: سندات سُجلت بعد إقفال كشفها، أو تسوية لسند ارتد أو مصروف عُدّل بعد صرفه.
                </Alert>
              </div>
            )}
            {s.status !== "DRAFT" && (
              <p className="no-print mt-2 text-[12px] text-muted">أرقام هذا الكشف مثبتة. أي سند أو مصروف يُسجل لاحقًا على هذه الفترة يظهر تلقائيًا في كشف الحساب التالي.</p>
            )}

            {/* Payment lines */}
            <h3 className="mt-6 mb-2 text-[14px] font-bold text-brand">أولًا: الإيجارات المحصلة خلال الفترة</h3>
            {paymentLines.length === 0 ? (
              <p className="text-[13px] text-muted">لا توجد دفعات محصلة خلال الفترة.</p>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <th>التاريخ</th>
                    <th>البيان</th>
                    <th className="num">حصة المالك</th>
                    <th className="num">أتعاب الإدارة</th>
                    <th className="num">الصافي</th>
                  </tr>
                </thead>
                <tbody>
                  {paymentLines.map((l) => (
                    <tr key={l.ledgerKey}>
                      <td>{date(l.date)}</td>
                      <td className="text-[12.5px]">
                        <span className="latin">{l.label}</span>
                        {l.note && <div className="text-[11.5px] text-muted">{l.note}</div>}
                      </td>
                      <td className="num">{money(l.amount, { decimals: true })}</td>
                      <td className="num text-muted">−{money(l.fee, { decimals: true })}</td>
                      <td className="num font-semibold">{money(l.amount - l.fee, { decimals: true })}</td>
                    </tr>
                  ))}
                  <tr className="font-bold">
                    <td colSpan={2}>الإجمالي</td>
                    <td className="num">{money(figures.collectedRent, { decimals: true })}</td>
                    <td className="num text-muted">−{money(figures.managementFees, { decimals: true })}</td>
                    <td className="num">{money(figures.collectedRent - figures.managementFees, { decimals: true })}</td>
                  </tr>
                </tbody>
              </Table>
            )}

            {/* Expense lines */}
            <h3 className="mt-6 mb-2 text-[14px] font-bold text-brand">ثانيًا: المصروفات المعتمدة المحمّلة على المالك</h3>
            {figures.expenseLines.length === 0 ? (
              <p className="text-[13px] text-muted">لا توجد مصروفات معتمدة خلال الفترة.</p>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <th>التاريخ</th>
                    <th>البيان</th>
                    <th>الفئة</th>
                    <th className="num">الإجمالي شامل الضريبة</th>
                    <th className="num">حصة المالك</th>
                  </tr>
                </thead>
                <tbody>
                  {figures.expenseLines.map((e) => (
                    <tr key={e.ledgerKey}>
                      <td>{date(e.date)}</td>
                      <td>
                        <Link href={`/expenses/${e.refId}`} className="hover:text-brand">
                          {e.label}
                        </Link>
                        {e.note && <div className="text-[11.5px] text-muted">{e.note}</div>}
                      </td>
                      <td>{e.category ? EXPENSE_CATEGORIES[e.category] ?? e.category : "—"}</td>
                      <td className="num text-muted">{e.gross ? money(e.gross, { decimals: true }) : "—"}</td>
                      <td className="num font-semibold">{money(e.amount, { decimals: true })}</td>
                    </tr>
                  ))}
                  <tr className="font-bold">
                    <td colSpan={4}>الإجمالي</td>
                    <td className="num">{money(figures.expenses, { decimals: true })}</td>
                  </tr>
                </tbody>
              </Table>
            )}

            {s.otherDeductions > 0 && (
              <>
                <h3 className="mt-6 mb-2 text-[14px] font-bold text-brand">ثالثًا: خصومات أخرى</h3>
                <KV k={s.notes ?? "خصومات أخرى"} v={<span className="num">−{money(s.otherDeductions, { decimals: true })}</span>} />
              </>
            )}
            {s.notes && s.otherDeductions === 0 && <p className="mt-4 rounded-xl bg-sand-75 px-4 py-3 text-[13px] text-text-2">{s.notes}</p>}

            <div className="mt-8 grid grid-cols-2 gap-6 border-t border-line pt-4 text-[12px] text-muted">
              <div>
                <div>إعداد: {s.organization.name}</div>
                <div className="mt-6 border-t border-dashed border-line pt-1">التوقيع والختم</div>
              </div>
              <div>
                <div>المالك: {s.owner.name}</div>
                <div className="mt-6 border-t border-dashed border-line pt-1">التوقيع</div>
              </div>
            </div>
            <p className="mt-3 text-[11px] text-faint">هذا الكشف صادر من نظام دارك — إدارة أملاكك. بصورة أوضح. الأرقام محتسبة حسب نسبة الملكية خلال الفترة.</p>
          </Card>
        </div>

        {/* ───── Workflow panel ───── */}
        <div className="no-print space-y-4">
          <Card title="سير الاعتماد" subtitle="مسودة ← مراجعة ← اعتماد ← تحويل ← إغلاق">
            <div className="mb-3 flex items-center gap-2">
              <StatusTag value={s.status} map={STATEMENT_STATUS} />
              {s.paidAt && <span className="text-[12px] text-muted">حُوّل {datetime(s.paidAt)}</span>}
            </div>
            {!canManage && <Alert tone="neutral">عرض فقط — إدارة التسويات متاحة للمحاسب ومدير المكتب.</Alert>}
            {canManage && (
              <div className="space-y-2">
                {s.status === "DRAFT" && (
                  <>
                    <ActionButton action={submitStatement} hidden={{ id: s.id }} className="btn btn-primary btn-sm w-full">
                      إرسال للمراجعة
                    </ActionButton>
                    {canApprove && (
                      <ActionButton action={approveStatement} hidden={{ id: s.id }} className="btn btn-outline btn-sm w-full">
                        اعتماد مباشر
                      </ActionButton>
                    )}
                  </>
                )}
                {s.status === "UNDER_REVIEW" && (
                  <>
                    {canApprove ? (
                      <ActionButton action={approveStatement} hidden={{ id: s.id }} className="btn btn-primary btn-sm w-full">
                        اعتماد كشف الحساب
                      </ActionButton>
                    ) : (
                      <Alert tone="info">بانتظار اعتماد مدير المكتب أو المحاسب.</Alert>
                    )}
                    <ActionButton action={backToDraft} hidden={{ id: s.id }} className="btn btn-ghost btn-sm w-full">
                      إعادة إلى مسودة
                    </ActionButton>
                  </>
                )}
                {s.status === "APPROVED" && (
                  <>
                    <form action={markStatementPaid} className="space-y-2 rounded-xl bg-mist p-3">
                      <input type="hidden" name="id" value={s.id} />
                      <div className="text-[13px] font-bold">تسجيل التحويل للمالك</div>
                      <Field label="تاريخ التحويل" name="paidAt">
                        <Input name="paidAt" type="date" defaultValue={inputDate(new Date())} />
                      </Field>
                      <Field label="مرجع التحويل" name="reference">
                        <Input name="reference" className="ltr" placeholder="رقم الحوالة / المرجع البنكي" />
                      </Field>
                      <button type="submit" className="btn btn-primary btn-sm w-full">
                        تأكيد التحويل — {money(s.netDue)} ر.س
                      </button>
                    </form>
                    <ActionButton action={closeStatement} hidden={{ id: s.id }} className="btn btn-ghost btn-sm w-full">
                      إغلاق بدون تحويل
                    </ActionButton>
                    <ActionButton action={backToDraft} hidden={{ id: s.id }} className="btn btn-link btn-sm w-full" confirm="إعادة كشف الحساب إلى مسودة تلغي الاعتماد وتفك تثبيت أرقامه. هل تريد المتابعة؟">
                      إعادة إلى مسودة
                    </ActionButton>
                  </>
                )}
                {s.status === "PAID" && (
                  <ActionButton action={closeStatement} hidden={{ id: s.id }} className="btn btn-outline btn-sm w-full">
                    إغلاق كشف الحساب
                  </ActionButton>
                )}
                {s.status === "CLOSED" && <Alert tone="success">التسوية مغلقة ومؤرشفة للتدقيق.</Alert>}
              </div>
            )}
          </Card>

          {canManage && s.status === "DRAFT" && (
            <Card title="خصومات أخرى" subtitle="تُطرح من صافي المستحق — متاحة أثناء المسودة فقط">
              <form action={updateDeductions} className="space-y-2">
                <input type="hidden" name="id" value={s.id} />
                <Field label="المبلغ (ر.س)" name="otherDeductions">
                  <Input name="otherDeductions" type="number" min={0} step="0.01" defaultValue={s.otherDeductions || ""} className="ltr" />
                </Field>
                <Field label="البيان / ملاحظات" name="notes">
                  <Textarea name="notes" rows={2} defaultValue={s.notes ?? ""} placeholder="مثال: سداد جزء من مستحقات صيانة سابقة" />
                </Field>
                <button type="submit" className="btn btn-outline btn-sm w-full">
                  حفظ الخصومات
                </button>
              </form>
            </Card>
          )}

          <Card title="الملخص" tone="dark">
            <KV k="الإيجار المحصل" v={<span className="num">{money(s.collectedRent)}</span>} />
            <KV k="أتعاب الإدارة" v={<span className="num">−{money(s.managementFees)}</span>} />
            <KV k="المصروفات المعتمدة" v={<span className="num">−{money(s.expenses)}</span>} />
            <KV k="خصومات أخرى" v={<span className="num">−{money(s.otherDeductions)}</span>} />
            <KV k="صافي المستحق" v={<b className="num text-xl text-sand-200">{money(s.netDue)} ر.س</b>} />
          </Card>

          <Card title="سجل العمليات">
            {logs.length === 0 ? (
              <EmptyState title="لا توجد عمليات مسجلة" />
            ) : (
              <div className="timeline">
                {logs.map((a) => (
                  <div key={a.id} className="timeline-item">
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
      </div>
    </>
  );
}

function FormulaCell({ label, value, negative }: { label: string; value: number; negative?: boolean }) {
  return (
    <div className="rounded-xl bg-white px-3 py-2">
      <div className="text-[11px] text-muted">{label}</div>
      <div className={`num text-[15px] font-bold ${negative ? "text-text-2" : "text-brand"}`}>
        {negative ? "−" : ""}
        {money(value, { decimals: true })}
      </div>
    </div>
  );
}
