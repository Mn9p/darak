import { notFound } from "next/navigation";
import { requireOwner } from "@/lib/auth";
import { db } from "@/lib/db";
import { statementFigures, type OwnerStatementFigures } from "@/lib/engine";
import { money, date, pct, datetime } from "@/lib/format";
import { STATEMENT_STATUS, EXPENSE_CATEGORIES } from "@/lib/constants";
import { PageHeader, Card, Table, StatusTag, DL, Alert } from "@/components/ui";
import { PrintHeader, PrintStyles } from "@/components/PrintHeader";
import { PrintButton } from "../../PrintButton";
import { StatementCommentForm } from "../CommentForm";
import { addStatementComment } from "../../actions";

export const dynamic = "force-dynamic";

export default async function OwnerStatementPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireOwner();
  const { id } = await params;
  const s = await db.ownerStatement.findFirst({
    where: { id, organizationId: user.organizationId, ownerId: user.ownerId, status: { in: ["APPROVED", "PAID", "CLOSED"] } },
    include: { property: { select: { name: true } }, owner: { select: { name: true, managementFeePct: true, bankName: true, iban: true } }, organization: { select: { name: true, phone: true, email: true, vatNumber: true, crNumber: true } } },
  });
  if (!s) notFound();

  let detail: OwnerStatementFigures | null = null;
  try {
    detail = await statementFigures(s);
  } catch {
    detail = null;
  }
  const tickets = await db.supportTicket.findMany({ where: { organizationId: user.organizationId, userId: user.id, subject: { contains: s.code } }, orderBy: { createdAt: "desc" }, select: { id: true, body: true, status: true, createdAt: true } });
  const maskedIban = s.owner.iban ? `${s.owner.iban.slice(0, 4)} •••• ${s.owner.iban.slice(-4)}` : null;

  return (
    <>
      <PrintStyles />
      <div className="no-print">
        <PageHeader
          title={
            <span className="flex flex-wrap items-center gap-2">
              كشف حساب <span className="latin">{s.code}</span> <StatusTag value={s.status} map={STATEMENT_STATUS} />
            </span>
          }
          subtitle={`الفترة ${date(s.periodStart)} — ${date(s.periodEnd)} · ${s.property?.name ?? "كل العقارات"}`}
          breadcrumbs={[{ label: "كشوف الحساب", href: "/owner/statements" }, { label: s.code }]}
          actions={<PrintButton label="طباعة الكشف" />}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card className="print-sheet">
            <PrintHeader
              orgName={s.organization.name}
              orgMeta={[s.organization.phone, s.organization.email, s.organization.vatNumber ? `الرقم الضريبي ${s.organization.vatNumber}` : null].filter(Boolean).join(" · ")}
              title="كشف حساب المالك"
              code={s.code}
              date={`صدر في ${date(s.createdAt)}`}
            />

            <DL
              cols={4}
              items={[
                { label: "المالك", value: s.owner.name },
                { label: "الفترة", value: <span className="num">{date(s.periodStart)} — {date(s.periodEnd)}</span> },
                { label: "العقار", value: s.property?.name ?? "كل العقارات" },
                { label: "نسبة أتعاب الإدارة", value: <span className="num">{pct(s.owner.managementFeePct, 0)}</span> },
              ]}
            />

            <div className="mt-5 rounded-2xl bg-mist p-4">
              <div className="mb-2 text-[12.5px] font-bold text-muted">كيف حُسب صافي المستحق</div>
              <div className="grid gap-2 text-[14px] md:grid-cols-[1fr_auto]">
                <Row label="الإيجارات المحصّلة (حصتك)" v={s.collectedRent} />
                <Row label="− أتعاب الإدارة" v={-s.managementFees} />
                <Row label="− المصروفات المعتمدة (حصتك)" v={-s.expenses} />
                {s.otherDeductions > 0 && <Row label="− خصومات أخرى" v={-s.otherDeductions} />}
                <div className="col-span-full my-1 border-t border-line" />
                <div className="font-bold">= صافي المستحق لك</div>
                <div className={`num text-left text-[20px] font-extrabold ${s.netDue >= 0 ? "text-success" : "text-danger"}`}>{money(s.netDue, { decimals: true })} ر.س</div>
              </div>
            </div>

            {s.status === "PAID" && (
              <div className="mt-4">
                <Alert tone="success" title="تم التحويل">
                  حُوّل المبلغ بتاريخ <span className="num">{date(s.paidAt)}</span>
                  {s.owner.bankName ? ` إلى حساب ${s.owner.bankName}` : ""}
                  {maskedIban ? <span className="latin"> ({maskedIban})</span> : null}.
                </Alert>
              </div>
            )}
            {s.notes && <p className="mt-4 text-[13px] text-muted">{s.notes}</p>}
          </Card>

          {detail && detail.lines.length > 0 && (
            <Card title="تفاصيل الإيجارات المحصّلة" subtitle="الدفعات المستلمة خلال الفترة على عقاراتك (حصتك)" padded={false}>
              <Table>
                <thead>
                  <tr>
                    <th>التاريخ</th>
                    <th>البيان</th>
                    <th>المبلغ</th>
                    <th>أتعاب الإدارة</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.lines
                    .sort((a, b) => a.date.getTime() - b.date.getTime())
                    .map((l, i) => (
                      <tr key={l.ledgerKey}>
                        <td className="num">{date(l.date)}</td>
                        <td>{l.label}</td>
                        <td className="num">{money(l.amount, { decimals: true })}</td>
                        <td className="num text-muted">{money(l.fee, { decimals: true })}</td>
                      </tr>
                    ))}
                </tbody>
              </Table>
            </Card>
          )}

          {detail && detail.expenseLines.length > 0 && (
            <Card title="تفاصيل المصروفات المعتمدة" padded={false}>
              <Table>
                <thead>
                  <tr>
                    <th>التاريخ</th>
                    <th>البيان</th>
                    <th>الفئة</th>
                    <th>الإجمالي</th>
                    <th>حصتك</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.expenseLines.map((e) => (
                    <tr key={e.ledgerKey}>
                      <td className="num">{date(e.date)}</td>
                      <td>
                        {e.label}
                        {e.note && <div className="text-[11.5px] text-muted">{e.note}</div>}
                      </td>
                      <td>{e.category ? EXPENSE_CATEGORIES[e.category] ?? e.category : "—"}</td>
                      <td className="num">{e.gross ? money(e.gross, { decimals: true }) : "—"}</td>
                      <td className="num font-bold">{money(e.amount, { decimals: true })}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          )}
        </div>

        <div className="no-print space-y-4">
          <Card title="ملاحظة على الكشف" subtitle="تصل ملاحظتك إلى المكتب ويُرد عليك هنا">
            <StatementCommentForm action={addStatementComment} statementId={s.id} />
          </Card>
          {tickets.length > 0 && (
            <Card title="ملاحظاتك السابقة">
              <div className="timeline">
                {tickets.map((t) => (
                  <div key={t.id} className={`timeline-item ${t.status === "RESOLVED" || t.status === "CLOSED" ? "" : "warning"}`}>
                    <div className="text-[13px] text-text">{t.body.split("\n")[0]}</div>
                    <div className="num text-[11px] text-muted">{datetime(t.createdAt)} · {t.status === "OPEN" ? "مفتوحة" : t.status === "IN_PROGRESS" ? "قيد المعالجة" : "تم الرد"}</div>
                  </div>
                ))}
              </div>
            </Card>
          )}
          <Card tone="dark" title="كيف يُحسب كشف الحساب؟">
            <ul className="space-y-1.5 text-[12.5px] text-[#C6D2CE]">
              <li>• تُحسب حصتك من كل دفعة حسب نسبة ملكيتك في تاريخ الدفع.</li>
              <li>• تُخصم أتعاب الإدارة حسب النسبة المتفق عليها في العقود.</li>
              <li>• تُخصم المصروفات المعتمدة فقط (بعد اعتماد المكتب).</li>
              <li>• تُحوّل المبالغ إلى حسابك البنكي المسجل لدى المكتب.</li>
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}

function Row({ label, v }: { label: string; v: number }) {
  return (
    <>
      <div className="text-text-2">{label}</div>
      <div className={`num text-left font-semibold ${v < 0 ? "text-danger" : "text-text"}`}>{v < 0 ? `(${money(-v, { decimals: true })})` : money(v, { decimals: true })} ر.س</div>
    </>
  );
}
