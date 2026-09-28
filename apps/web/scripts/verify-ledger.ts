/* End-to-end check of the owner-statement ledger on a THROWAWAY copy of the demo database.
   Usage: DATABASE_URL="file:<absolute path to a copy of dev.db>" npx tsx scripts/verify-ledger.ts
   Refuses to run against packages/db/prisma/schema/dev.db or any non-SQLite database. */
import "./env";
import { db } from "@darak/db";
import { computeOwnerStatement, freezeStatement, refreshInstallments } from "../src/lib/engine";
import { startOfMonth, endOfMonth, addMonths } from "../src/lib/format";

const url = process.env.DATABASE_URL ?? "";
if (!url.startsWith("file:") || /prisma[\\/]schema[\\/]dev\.db$/.test(url)) {
  console.error("verify-ledger: point DATABASE_URL at a copy of dev.db (absolute path), never the real one.");
  process.exit(1);
}

let failures = 0;
const check = (ok: boolean, label: string) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) failures++;
};
const near = (a: number, b: number) => Math.abs(a - b) < 0.02;

async function main() {
  // An owner with approved rent in some past month.
  const alloc = await db.paymentAllocation.findFirst({
    where: { payment: { status: "APPROVED" }, installment: { contract: { ownerId: { not: undefined } } } },
    orderBy: { payment: { paidAt: "desc" } },
    include: { payment: true, installment: { include: { contract: true } } },
  });
  if (!alloc) throw new Error("no approved allocation in the demo data");
  const org = alloc.payment.organizationId;
  const ownerId = alloc.installment.contract.ownerId;
  const start = startOfMonth(alloc.payment.paidAt);
  const end = endOfMonth(alloc.payment.paidAt);
  // Clean slate for this owner (throwaway DB).
  await db.ownerStatementLine.deleteMany({ where: { ownerId } });
  await db.ownerStatement.deleteMany({ where: { ownerId } });

  // 1) Freeze an all-properties statement for the month.
  const s1 = await db.ownerStatement.create({ data: { organizationId: org, code: "VERIFY-1", ownerId, propertyId: null, periodStart: start, periodEnd: end, status: "DRAFT" } });
  const live = await computeOwnerStatement(org, ownerId, start, end, null, { carry: true, excludeStatementId: s1.id });
  const frozen = await freezeStatement(s1.id);
  await db.ownerStatement.update({ where: { id: s1.id }, data: { status: "APPROVED" } });
  const lines = await db.ownerStatementLine.findMany({ where: { statementId: s1.id } });
  check(lines.length > 0, `freeze wrote ${lines.length} lines`);
  check(near(frozen.collectedRent, lines.filter((l) => l.kind === "RENT").reduce((s, l) => s + l.amount, 0)), "frozen rent = sum of RENT lines");
  check(near(frozen.collectedRent, live.collectedRent) && near(frozen.expenses, live.expenses), "frozen totals = live draft totals");
  const includesAlloc = lines.some((l) => l.refId === alloc.id);
  check(includesAlloc, "the sampled allocation is in the frozen statement");

  // 2) A second statement for the same month (per property) pays nothing twice.
  const again = await computeOwnerStatement(org, ownerId, start, end, alloc.installment.contract.propertyId, { carry: true });
  check(!again.all.some((l) => l.refId === alloc.id), "same money is not offered again in an overlapping statement");

  // 3) The cheque bounces after the statement was paid → next month's statement claws it back.
  const ownLine = lines.find((l) => l.refId === alloc.id)!;
  await db.payment.update({ where: { id: alloc.paymentId }, data: { status: "RETURNED" } });
  await refreshInstallments(org, [alloc.installmentId]);
  const nextStart = startOfMonth(addMonths(start, 1));
  const nextEnd = endOfMonth(nextStart);
  const next = await computeOwnerStatement(org, ownerId, nextStart, nextEnd, null, { carry: true });
  const claw = next.all.find((l) => l.refId === alloc.id);
  check(Boolean(claw) && near(claw!.amount, -ownLine.amount) && near(claw!.fee, -ownLine.fee), `bounced cheque clawed back next month (${claw?.amount} vs ${-ownLine.amount})`);
  const inst = await db.installment.findUnique({ where: { id: alloc.installmentId } });
  check(Boolean(inst) && inst!.status !== "PAID", `installment re-opened after the bounce (status ${inst?.status})`);

  // 4) A late receipt dated inside the frozen month appears as a carried line next month, once.
  const lateInst = await db.installment.findFirst({ where: { contractId: alloc.installment.contractId, status: { in: ["DUE", "OVERDUE", "PARTIALLY_PAID", "UPCOMING"] } } });
  if (lateInst) {
    const late = await db.payment.create({
      data: { organizationId: org, code: "VERIFY-LATE", tenantId: lateInst.tenantId, contractId: lateInst.contractId, paidAt: new Date(start.getTime() + 5 * 86400e3), amount: 100, method: "BANK_TRANSFER", status: "APPROVED", allocations: { create: [{ installmentId: lateInst.id, amount: 100 }] } },
      include: { allocations: true },
    });
    const next2 = await computeOwnerStatement(org, ownerId, nextStart, nextEnd, null, { carry: true });
    const carried = next2.all.filter((l) => l.refId === late.allocations[0].id);
    check(carried.length === 1 && carried[0].carried && carried[0].amount > 0, "late receipt for a frozen month is carried into the next statement");
  } else console.log("SKIP  late-receipt check (no open installment on that contract)");

  console.log(failures ? `\n${failures} check(s) failed` : "\nledger: all checks passed");
  process.exit(failures ? 1 : 0);
}

main().finally(() => db.$disconnect());
