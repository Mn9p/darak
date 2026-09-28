import Link from "next/link";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { RECONCILIATION_STATUS } from "@/lib/constants";
import { money, date, inputDate, addDays } from "@/lib/format";
import { PageHeader, Card, Table, StatusTag, EmptyState, Tabs, StatGrid, StatCard, ActionButton, Alert, Textarea, Input, Field, Select, FilterBar } from "@/components/ui";
import { GuideCard } from "@/components/GuideCard";
import { Optional } from "@/components/MoreMenu";
import { importBankStatement, confirmMatch, unmatch, markReviewed, markDuplicate } from "./actions";
import { textLike } from "@/lib/search";

export const dynamic = "force-dynamic";
const MATCH_WINDOW_DAYS = 5;
const TAB_ORDER = ["SUGGESTED", "UNMATCHED", "NEEDS_REVIEW", "MATCHED", "DUPLICATE"];

export default async function ReconciliationPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireStaff();
  if (!can(user, "payments.view")) redirect("/forbidden");
  const sp = await searchParams;
  const org = user.organizationId;
  const tab = TAB_ORDER.includes(sp.tab ?? "") ? sp.tab! : "SUGGESTED";
  const q = sp.q?.trim();
  const canMutate = can(user, "payments.approve");

  const [counts, rows, candidates] = await Promise.all([
    db.bankTransaction.groupBy({ by: ["status"], where: { organizationId: org }, _count: true }),
    db.bankTransaction.findMany({
      where: { organizationId: org, status: tab, ...(q ? { OR: [{ reference: textLike(q) }, { description: textLike(q) }] } : {}) },
      orderBy: { date: "desc" },
      take: 200,
      include: { payment: { select: { id: true, code: true, paidAt: true, tenant: { select: { name: true } } } } },
    }),
    ["SUGGESTED", "UNMATCHED", "NEEDS_REVIEW"].includes(tab)
      ? db.payment.findMany({
          where: { organizationId: org, status: { in: ["RECORDED", "APPROVED"] }, reconciliationStatus: { not: "MATCHED" }, bankTxn: null },
          orderBy: { paidAt: "desc" },
          select: { id: true, code: true, amount: true, paidAt: true, reference: true, tenant: { select: { name: true } } },
        })
      : Promise.resolve([]),
  ]);

  const countOf = (s: string) => counts.find((c) => c.status === s)?._count ?? 0;
  const tabs = TAB_ORDER.map((k) => ({ key: k, label: RECONCILIATION_STATUS[k].label, count: countOf(k) }));
  const totalTxns = counts.reduce((s, c) => s + c._count, 0);
  const matchedPct = totalTxns ? Math.round((countOf("MATCHED") / totalTxns) * 100) : 0;
  const currentUrl = `/reconciliation?tab=${tab}${q ? `&q=${encodeURIComponent(q)}` : ""}`;

  const sameAmount = (amount: number) => candidates.filter((p) => Math.abs(p.amount - amount) < 0.01);
  const suggestFor = (amount: number, d: Date) => {
    const lo = addDays(d, -MATCH_WINDOW_DAYS);
    const hi = addDays(d, MATCH_WINDOW_DAYS);
    return sameAmount(amount).find((p) => p.paidAt >= lo && p.paidAt <= hi) ?? null;
  };

  return (
    <>
      <PageHeader
        title="المطابقة البنكية"
        subtitle="طابق حركات كشف الحساب مع الدفعات المسجلة."
        actions={
          <Link href="/payments" className="btn btn-outline btn-sm">
            سندات القبض
          </Link>
        }
      />

      <GuideCard
        id="reconciliation"
        show={totalTxns === 0}
        title="المطابقة البنكية: تأكد أن ما في البنك هو ما سجّلته"
        steps={[
          "استورد كشف الحساب البنكي (CSV) من النموذج أسفل هذه الصفحة.",
          "يقترح النظام مطابقة كل حركة مع سند قبض بنفس المبلغ والتاريخ.",
          "أكّد المطابقة، أو أنشئ سندًا للحركة التي لا سند لها.",
        ]}
        note="الحركات تأتي من ملف البنك فقط؛ لا تُدخل يدويًا."
        cta={{ href: "/payments", label: "سندات القبض" }}
      />

      {sp.imported && (
        <div className="mb-4">
          <Alert tone="success" title="تم استيراد كشف الحساب">
            أُضيفت <b className="num">{sp.imported}</b> حركة · مطابقات مقترحة <b className="num">{sp.sug ?? 0}</b> · مكررة <b className="num">{sp.dup ?? 0}</b> · تم تجاهل <b className="num">{sp.skipped ?? 0}</b> سطر غير صالح.
          </Alert>
        </div>
      )}

      <StatGrid cols={4}>
        <StatCard label="مطابقة مقترحة" value={money(countOf("SUGGESTED"))} tone={countOf("SUGGESTED") > 0 ? "warning" : undefined} href="/reconciliation?tab=SUGGESTED" />
        <StatCard label="غير مطابقة" value={money(countOf("UNMATCHED"))} tone={countOf("UNMATCHED") > 0 ? "danger" : undefined} href="/reconciliation?tab=UNMATCHED" />
        <StatCard label="تحتاج مراجعة" value={money(countOf("NEEDS_REVIEW"))} href="/reconciliation?tab=NEEDS_REVIEW" />
        <StatCard label="نسبة المطابقة" value={`${matchedPct}%`} sub={`${money(countOf("MATCHED"))} من ${money(totalTxns)} حركة`} dark />
      </StatGrid>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2" padded={false}>
          <div className="px-4 pt-4">
            <Tabs tabs={tabs} active={tab} base="/reconciliation" />
            <FilterBar base="/reconciliation" hasFilters={Boolean(q)}>
              <input type="hidden" name="tab" value={tab} />
              <Input name="q" placeholder="بحث بالمرجع أو الوصف" defaultValue={q ?? ""} className="!w-64" />
            </FilterBar>
          </div>
          {rows.length === 0 ? (
            <EmptyState
              title={q ? "لا توجد حركات مطابقة للبحث" : `لا توجد حركات بحالة «${RECONCILIATION_STATUS[tab].label}»`}
              description={tab === "SUGGESTED" || tab === "UNMATCHED" ? "استورد كشف حساب جديد لبدء المطابقة." : undefined}
              action={q ? <Link href={`/reconciliation?tab=${tab}`} className="btn btn-outline">مسح البحث</Link> : undefined}
            />
          ) : (
            <Table>
              <thead>
                <tr>
                  <th>التاريخ</th>
                  <th className="num">المبلغ</th>
                  <th>المرجع</th>
                  <th>البنك</th>
                  <th>الحالة</th>
                  <th>الدفعة المطابقة</th>
                  {canMutate && <th>إجراء</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => {
                  const suggestion = t.status === "SUGGESTED" ? suggestFor(t.amount, t.date) : null;
                  const options = t.status === "UNMATCHED" || t.status === "NEEDS_REVIEW" ? sameAmount(t.amount) : [];
                  const newPaymentHref = `/payments/new?amount=${t.amount}&reference=${encodeURIComponent(t.reference ?? "")}&date=${inputDate(t.date)}`;
                  return (
                    <tr key={t.id}>
                      <td>{date(t.date)}</td>
                      <td className={`num font-bold ${t.amount < 0 ? "text-danger" : ""}`}>{money(t.amount, { decimals: true })}</td>
                      <td>
                        <span className="latin">{t.reference ?? "—"}</span>
                        {t.description && (
                          <div className="cell-sub max-w-[220px] truncate" title={t.description}>
                            {t.description}
                          </div>
                        )}
                      </td>
                      <td className="text-muted">{t.bank ?? "—"}</td>
                      <td>
                        <StatusTag value={t.status} map={RECONCILIATION_STATUS} />
                      </td>
                      <td className="text-[12.5px]">
                        {t.payment ? (
                          <>
                            <Link href={`/payments/${t.payment.id}`} className="link latin">
                              {t.payment.code}
                            </Link>
                            <div className="cell-sub">
                              {t.payment.tenant.name} · {date(t.payment.paidAt)}
                            </div>
                          </>
                        ) : suggestion ? (
                          <>
                            <Link href={`/payments/${suggestion.id}`} className="link latin">
                              {suggestion.code}
                            </Link>
                            <div className="cell-sub">
                              {suggestion.tenant.name} · {date(suggestion.paidAt)}
                            </div>
                          </>
                        ) : t.status === "SUGGESTED" ? (
                          <span className="text-faint">لم يعد الاقتراح متاحًا</span>
                        ) : (
                          <span className="text-faint">—</span>
                        )}
                      </td>
                      {canMutate && (
                        <td>
                          <div className="flex flex-wrap items-center gap-1">
                            {t.status === "MATCHED" && (
                              <ActionButton action={unmatch} hidden={{ id: t.id, back: currentUrl }} className="btn btn-ghost btn-xs" confirm="إلغاء المطابقة؟">
                                إلغاء المطابقة
                              </ActionButton>
                            )}
                            {t.status === "SUGGESTED" &&
                              (suggestion ? (
                                <ActionButton action={confirmMatch} hidden={{ id: t.id, paymentId: suggestion.id, back: currentUrl }} className="btn btn-primary btn-xs">
                                  تأكيد المطابقة
                                </ActionButton>
                              ) : (
                                <ActionButton action={unmatch} hidden={{ id: t.id, back: currentUrl }} className="btn btn-ghost btn-xs">
                                  نقل إلى غير مطابقة
                                </ActionButton>
                              ))}
                            {(t.status === "UNMATCHED" || t.status === "NEEDS_REVIEW") && (
                              <>
                                {options.length > 0 && (
                                  <form action={confirmMatch} className="flex items-center gap-1">
                                    <input type="hidden" name="id" value={t.id} />
                                    <input type="hidden" name="back" value={currentUrl} />
                                    <Select name="paymentId" options={options.map((p) => ({ value: p.id, label: `${p.code} · ${p.tenant.name} · ${date(p.paidAt)}` }))} placeholder="اختر الدفعة" className="!h-8 !w-52 !text-xs" required />
                                    <button type="submit" className="btn btn-primary btn-xs">
                                      تأكيد
                                    </button>
                                  </form>
                                )}
                                {t.amount > 0 && (
                                  <Link href={newPaymentHref} className="btn btn-outline btn-xs">
                                    إنشاء دفعة من الحركة
                                  </Link>
                                )}
                              </>
                            )}
                            {t.status !== "MATCHED" && (
                              <ActionButton action={markReviewed} hidden={{ id: t.id, back: currentUrl }} className="btn btn-ghost btn-xs">
                                {t.status === "NEEDS_REVIEW" ? "تمت المراجعة" : "للمراجعة"}
                              </ActionButton>
                            )}
                            {t.status !== "MATCHED" && t.status !== "DUPLICATE" && (
                              <ActionButton action={markDuplicate} hidden={{ id: t.id, back: currentUrl }} className="btn btn-ghost btn-xs" confirm="وسم الحركة كمكررة؟">
                                مكررة
                              </ActionButton>
                            )}
                            {t.status === "DUPLICATE" && (
                              <ActionButton action={unmatch} hidden={{ id: t.id, back: currentUrl }} className="btn btn-ghost btn-xs">
                                ليست مكررة
                              </ActionButton>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Card>

        <div className="space-y-4">
          {canMutate ? (
            <Card title="استيراد كشف حساب">
              <form action={importBankStatement} className="space-y-3">
                <Field label="البنك" name="bank">
                  <Input name="bank" placeholder="الراجحي" />
                </Field>
                <Field label="أسطر الكشف" name="csv" required help="التاريخ، المبلغ، المرجع، الوصف في كل سطر.">
                  <Textarea name="csv" rows={8} className="ltr !font-mono !text-xs" placeholder={"date,amount,reference,description\n2026-09-10,15000,TRF123456,حوالة واردة"} required />
                </Field>
                <button type="submit" className="btn btn-primary w-full">
                  استيراد ومطابقة
                </button>
              </form>
            </Card>
          ) : (
            <Card title="استيراد كشف حساب">
              <p className="text-[13px] text-muted">الاستيراد والمطابقة متاحان لأصحاب صلاحية اعتماد المدفوعات.</p>
            </Card>
          )}
          <Optional title="كيف تعمل المطابقة؟">
            <ul className="list-disc space-y-1.5 pr-4 text-[13px] text-text-2">
              <li>
                <b>مطابقة مقترحة:</b> دفعة بنفس المبلغ خلال {MATCH_WINDOW_DAYS} أيام قبل الحركة أو بعدها.
              </li>
              <li>
                <b>غير مطابقة:</b> اختر دفعة بنفس المبلغ يدويًا، أو أنشئ دفعة جديدة من الحركة.
              </li>
              <li>
                <b>مكررة:</b> نفس المرجع والمبلغ لحركة موجودة مسبقًا.
              </li>
              <li>
                <b>تحتاج مراجعة:</b> مبالغ صادرة أو حركات بلا بيان واضح.
              </li>
            </ul>
          </Optional>
        </div>
      </div>
    </>
  );
}
