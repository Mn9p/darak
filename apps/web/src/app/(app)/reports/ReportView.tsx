import Link from "next/link";
import { money, pct, date } from "@/lib/format";
import { Card, StatCard, StatGrid, Table, EmptyState, StatusTag } from "@/components/ui";
import { LogoMark } from "@/components/Logo";
import { PrintHeader, PrintStyles } from "@/components/PrintHeader";
import type { ReportResult, Chart, Column, Cell } from "./queries";

/** Print-only document header: logo + office name + report title + period. Hidden on screen. */
export function ReportPrintHeader({ orgName, title, period }: { orgName: string; title: string; period?: string }) {
  return (
    <div className="hidden print:block">
      <PrintStyles />
      <PrintHeader orgName={orgName} title={title} date={period ?? date(new Date())} />
    </div>
  );
}

/** Rule-based narrative — computed from the numbers, not an LLM call. */
export function SmartSummary({ text, note }: { text: string; note?: string }) {
  return (
    <div className="mb-4 rounded-2xl border border-sand-200 bg-sand-75 px-5 py-4">
      <div className="mb-1 flex items-center gap-2 text-[12.5px] font-bold text-brand">
        <LogoMark size={16} />
        الملخص
      </div>
      <p className="text-[14px] leading-relaxed text-text">{text}</p>
      {note && <p className="mt-1 text-[12px] text-muted">{note}</p>}
    </div>
  );
}

export function ReportStats({ stats }: { stats: ReportResult["stats"] }) {
  if (!stats.length) return null;
  const cols = stats.length >= 4 ? 4 : (stats.length as 2 | 3);
  return (
    <StatGrid cols={cols}>
      {stats.map((s, i) => (
        <StatCard key={i} label={s.label} value={s.value} sub={s.sub} tone={s.tone} dark={i === stats.length - 1 && stats.length >= 4} />
      ))}
    </StatGrid>
  );
}

const fmt = (v: number, f?: Chart["format"]) => (f === "pct" ? pct(v, 0) : f === "num" ? money(v) : money(v, { compact: true }));

/** Simple CSS bar chart — same visual language as the dashboard (no chart libs). */
export function ReportChart({ chart }: { chart: Chart }) {
  const points = chart.points;
  if (!points.length) return null;
  const max = Math.max(1, ...points.map((p) => (chart.stacked ? chart.series.reduce((s, k) => s + (p.values[k.key] ?? 0), 0) : Math.max(...chart.series.map((k) => p.values[k.key] ?? 0)))));
  const many = points.length > 8;
  return (
    <Card title={chart.title} className="mt-4">
      <div className={`flex items-end gap-1.5 ${many ? "h-44" : "h-52"}`}>
        {points.map((p, i) => {
          const total = chart.series.reduce((s, k) => s + (p.values[k.key] ?? 0), 0);
          return (
            <div key={i} className="flex min-w-0 flex-1 flex-col items-center gap-1">
              <span className="num text-[10.5px] text-muted">{fmt(chart.stacked ? total : Math.max(...chart.series.map((k) => p.values[k.key] ?? 0)), chart.format)}</span>
              {chart.stacked ? (
                <div className="flex w-full flex-col-reverse justify-start rounded-t-md bg-mist" style={{ height: many ? 120 : 150 }}>
                  {chart.series.map((k) => (
                    <div key={k.key} style={{ height: `${((p.values[k.key] ?? 0) / max) * 100}%`, background: k.color }} title={`${k.label}: ${fmt(p.values[k.key] ?? 0, chart.format)}`} />
                  ))}
                </div>
              ) : (
                <div className="flex w-full items-end justify-center gap-0.5 rounded-t-md bg-mist px-0.5" style={{ height: many ? 120 : 150 }}>
                  {chart.series.map((k) => (
                    <div key={k.key} className="min-w-[4px] flex-1 rounded-t" style={{ height: `${Math.max(1, ((p.values[k.key] ?? 0) / max) * 100)}%`, background: k.color }} title={`${k.label}: ${fmt(p.values[k.key] ?? 0, chart.format)}`} />
                  ))}
                </div>
              )}
              <span className="w-full truncate text-center text-[10.5px] text-muted" title={p.label}>
                {p.label}
              </span>
            </div>
          );
        })}
      </div>
      {chart.series.length > 1 && (
        <div className="mt-3 flex flex-wrap gap-4 text-[12px] text-muted">
          {chart.series.map((k) => (
            <span key={k.key} className="flex items-center gap-1">
              <i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: k.color }} /> {k.label}
            </span>
          ))}
        </div>
      )}
    </Card>
  );
}

function CellView({ cell, col }: { cell: Cell; col: Column }) {
  if (cell === null || cell === undefined) return <span className="text-faint">—</span>;
  if (cell instanceof Date) return <>{date(cell)}</>;
  if (typeof cell === "object") {
    return (
      <>
        <Link href={cell.href} className="cell-primary hover:text-brand">
          {cell.label}
        </Link>
        {cell.sub && <div className="cell-sub latin">{cell.sub}</div>}
      </>
    );
  }
  switch (col.kind) {
    case "money":
      return <span className={`num font-semibold ${Number(cell) < 0 ? "text-danger" : ""}`}>{money(Number(cell))}</span>;
    case "num":
      return <span className="num">{money(Number(cell))}</span>;
    case "pct":
      return <span className={`num ${Number(cell) < 0 ? "text-danger" : ""}`}>{pct(Number(cell), 1)}</span>;
    case "status":
      return col.map ? <StatusTag value={String(cell)} map={col.map} /> : <>{String(cell)}</>;
    default:
      return <>{String(cell)}</>;
  }
}

export function ReportTable({ columns, rows, title }: { columns: Column[]; rows: ReportResult["rows"]; title?: string }) {
  return (
    <Card className="mt-4" padded={false} title={title ?? `البيانات (${rows.length})`}>
      {rows.length === 0 ? (
        <EmptyState title="لا توجد بيانات للفترة المختارة" description="جرّب توسيع الفترة أو إزالة أحد الفلاتر." />
      ) : (
        <Table>
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} className={["money", "num", "pct"].includes(c.kind ?? "") ? "num" : ""}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                {columns.map((c) => (
                  <td key={c.key} className={["money", "num", "pct"].includes(c.kind ?? "") ? "num" : ""}>
                    <CellView cell={r[c.key]} col={c} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}
