import { db } from "./db";

const PREFIX: Record<string, string> = {
  owner: "OWN",
  property: "PRP",
  unit: "UNT",
  tenant: "TNT",
  contract: "CNT",
  payment: "PAY",
  expense: "EXP",
  ownerStatement: "STM",
};

const pad = (n: number) => String(n).padStart(4, "0");

/**
 * Next sequential code for an entity inside an organization, e.g. PRP-0012.
 * Backed by an atomic counter row (Sequence) so two users saving at the same second never get the same code.
 * The counter is seeded from the highest existing code the first time it is used (imports, legacy data).
 */
export async function nextCode(organizationId: string, entity: keyof typeof PREFIX): Promise<string> {
  const prefix = PREFIX[entity];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const model = (db as any)[entity];
  const key = { organizationId_entity: { organizationId, entity } };

  for (let attempt = 0; attempt < 5; attempt++) {
    const row = await db.sequence.findUnique({ where: key });
    if (!row) {
      const existing: { code: string }[] = await model.findMany({ where: { organizationId }, select: { code: true } });
      const max = existing.reduce((m, r) => {
        const n = Number(String(r.code).split("-").pop());
        return Number.isFinite(n) ? Math.max(m, n) : m;
      }, 0);
      // Native upsert (INSERT … ON CONFLICT) so parallel first calls never throw; the loop then increments.
      await db.sequence.upsert({ where: key, create: { organizationId, entity, value: max }, update: {} });
      continue;
    }
    const next = await db.sequence.update({ where: key, data: { value: { increment: 1 } } });
    const code = `${prefix}-${pad(next.value)}`;
    const exists = await model.findFirst({ where: { organizationId, code }, select: { id: true } });
    if (!exists) return code;
  }
  return `${prefix}-${Date.now()}`;
}
