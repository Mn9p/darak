// Test accounts: one fixed fake mobile number per role, for trying DARAK without SMS.
// · Their sign-in code is never sent (no SMS provider is called) and is shown on the login screen instead.
// · They live in their own sandbox office with fake data, so they can never reach a real office (tenant isolation).
// · The platform admin creates the sandbox from /admin ("الحسابات التجريبية", lib/test-office.ts); locally
//   `pnpm db:reset:demo` creates the same numbers inside the demo office.
// · TEST_ACCOUNTS=off turns all of this off (use it for the real launch). The platform-admin role is never a test account.
import { db } from "./db";

export const TEST_ACCOUNTS = [
  { phone: "966500000001", label: "صاحب الحساب", hint: "يرى كل شيء ويدير الفريق" },
  { phone: "966500000002", label: "موظف — إدارة العقارات", hint: "عقاره المسند فقط" },
  { phone: "966500000004", label: "موظف — التأجير", hint: "الوحدات والعقود والمستأجرون" },
  { phone: "966500000005", label: "موظف — التحصيل", hint: "المطالبات وسندات القبض" },
  { phone: "966500000007", label: "موظف — المحاسبة", hint: "السندات والمصروفات والكشوف" },
  { phone: "966500000009", label: "موظف — اطلاع فقط", hint: "يرى ولا يعدّل" },
  { phone: "966500000010", label: "مالك عقار", hint: "بوابة المالك" },
  { phone: "966500000011", label: "مستأجر", hint: "بوابة المستأجر" },
] as const;

export function testAccountsEnabled() {
  return (process.env.TEST_ACCOUNTS ?? "on").toLowerCase() !== "off";
}

/** A test number (normalized 9665…): signs in with an on-screen code, never by SMS. */
export function isTestPhone(phone: string) {
  return testAccountsEnabled() && TEST_ACCOUNTS.some((a) => a.phone === phone);
}

/** Test numbers that have an account in this database (shown on the login screen). */
export async function availableTestAccounts() {
  if (!testAccountsEnabled()) return [];
  const users = await db.user.findMany({ where: { phone: { in: TEST_ACCOUNTS.map((a) => a.phone) }, status: "ACTIVE", role: { not: "SUPER_ADMIN" } }, select: { phone: true } });
  const have = new Set(users.map((u) => u.phone));
  return TEST_ACCOUNTS.filter((a) => have.has(a.phone)).map((a) => ({ ...a }));
}
