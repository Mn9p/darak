/* eslint-disable no-console */
// Production seed: creates NO example data. The only thing it does is make sure a SUPER_ADMIN account exists
// for every Saudi mobile listed in SUPER_ADMIN_PHONES (comma-separated: "0501234567, +966 55 123 4567").
// Idempotent — safe to run on every deploy. Demo data is a separate opt-in: pnpm db:seed:demo.
import "./env";
import { db } from "@darak/db";
import { normalizePhone } from "../src/lib/phone";

async function main() {
  const raw = process.env.SUPER_ADMIN_PHONES ?? "";
  const phones = raw.split(",").map((p) => p.trim()).filter(Boolean);
  if (phones.length === 0) {
    console.log("seed: nothing to do (SUPER_ADMIN_PHONES not set, no example data is created)");
    return;
  }
  let created = 0;
  let existing = 0;
  const invalid: string[] = [];
  for (const p of phones) {
    const phone = normalizePhone(p);
    if (!phone) {
      invalid.push(p);
      continue;
    }
    const before = await db.user.findUnique({ where: { phone }, select: { id: true } });
    await db.user.upsert({
      where: { phone },
      create: { phone, name: "فريق دارك", role: "SUPER_ADMIN", jobTitle: "Platform Admin" },
      update: {},
    });
    if (before) existing++;
    else created++;
  }
  console.log(`seed: super admins — ${created} created, ${existing} already present${invalid.length ? `, ${invalid.length} skipped (not a Saudi mobile: ${invalid.join(", ")})` : ""}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
