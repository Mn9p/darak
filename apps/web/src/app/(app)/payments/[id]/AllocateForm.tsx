"use client";

import { useActionState, useState } from "react";
import { Alert, Input, Table, type FormState } from "@/components/ui";
import { allocatePayment } from "../actions";

type Row = { id: string; contractCode: string; unitNumber: string; seq: number; dueLabel: string; remaining: number };
const nf = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const r2 = (n: number) => Math.round(n * 100) / 100;

export function AllocateForm({ paymentId, available, rows }: { paymentId: string; available: number; rows: Row[] }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(allocatePayment, null);
  const [alloc, setAlloc] = useState<Record<string, number>>({});
  const sum = r2(rows.reduce((s, r) => s + (alloc[r.id] || 0), 0));
  const over = sum > available + 0.009;

  function auto() {
    let left = available;
    const next: Record<string, number> = {};
    for (const r of rows) {
      if (left <= 0) break;
      const take = Math.min(r.remaining, left);
      if (take > 0) next[r.id] = r2(take);
      left = r2(left - take);
    }
    setAlloc(next);
  }

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="id" value={paymentId} />
      {state?.error && <Alert tone="danger">{state.error}</Alert>}
      {state?.success && <Alert tone="success">{state.success}</Alert>}
      <div className="flex items-center justify-between text-[13px]">
        <span>
          المتاح للتخصيص: <b className="num">{nf.format(available)}</b> ر.س
        </span>
        <button type="button" className="btn btn-outline btn-xs" onClick={auto}>
          تخصيص تلقائي (الأقدم أولًا)
        </button>
      </div>
      <Table>
        <thead>
          <tr>
            <th>العقد / الوحدة</th>
            <th className="num">القسط</th>
            <th>الاستحقاق</th>
            <th className="num">المتبقي</th>
            <th className="num w-36">التخصيص</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>
                <span className="latin">{r.contractCode}</span>
                <div className="cell-sub latin">{r.unitNumber}</div>
              </td>
              <td className="num">{r.seq}</td>
              <td>{r.dueLabel}</td>
              <td className="num font-semibold">{nf.format(r.remaining)}</td>
              <td>
                <Input name={`alloc_${r.id}`} type="number" min={0} max={r.remaining} step="0.01" value={alloc[r.id] || ""} onChange={(e) => setAlloc({ ...alloc, [r.id]: Math.min(r.remaining, Number(e.target.value) || 0) })} className="!h-8 !text-xs" placeholder="0" />
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
      <div className="flex items-center justify-between text-[13px]">
        <span className={over ? "text-danger" : "text-muted"}>
          المخصص الآن: <b className="num">{nf.format(sum)}</b> · المتبقي بعد التخصيص: <b className="num">{nf.format(r2(available - sum))}</b>
        </span>
        <button type="submit" className="btn btn-primary btn-sm" disabled={pending || over || sum <= 0}>
          {pending ? "جارٍ الحفظ…" : "حفظ التخصيص"}
        </button>
      </div>
    </form>
  );
}
