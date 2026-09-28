import Link from "next/link";
import type { ReactNode } from "react";
import type { Tone } from "@/lib/constants";

/** Tiny inline trend line. Values are plotted left-to-right (oldest first). */
export function Sparkline({ values, width = 84, height = 28, stroke = "var(--dk-green-500)", fill = true, className = "" }: { values: number[]; width?: number; height?: number; stroke?: string; fill?: boolean; className?: string }) {
  if (!values.length) return null;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const step = values.length > 1 ? width / (values.length - 1) : width;
  const pts = values.map((v, i) => [i * step, height - ((v - min) / span) * (height - 4) - 2] as const);
  const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${d} L${width},${height} L0,${height} Z`;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={className} aria-hidden style={{ direction: "ltr" }}>
      {fill && <path d={area} fill={stroke} opacity={0.12} />}
      <path d={d} fill="none" stroke={stroke} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r={2.2} fill={stroke} />
    </svg>
  );
}

export function StatCard({
  label,
  value,
  sub,
  dark,
  href,
  tone,
  delta,
  spark,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  dark?: boolean;
  href?: string;
  tone?: Tone;
  /** Change versus a previous period. `label` always shown next to the number so colour is never the only signal. */
  delta?: { value: number; label: string; invert?: boolean };
  /** Oldest → newest. Rendered as a sparkline in the corner. */
  spark?: number[];
}) {
  const toneClass = tone === "danger" ? "!text-danger" : tone === "warning" ? "!text-warning" : tone === "success" ? "!text-success" : "";
  const dir = delta ? (delta.value > 0 ? "up" : delta.value < 0 ? "down" : "flat") : null;
  const good = delta ? (delta.invert ? delta.value <= 0 : delta.value >= 0) : true;
  const body = (
    <div className={`statcard h-full ${dark ? "dark" : ""}`}>
      <div className="lbl">{label}</div>
      <div className={`val ${toneClass}`}>{value}</div>
      {sub && <div className="sub">{sub}</div>}
      {delta && dir && (
        <div className={`delta ${dir === "flat" ? "flat" : good ? "up" : "down"}`}>
          <span aria-hidden>{dir === "up" ? "▲" : dir === "down" ? "▼" : "•"}</span>
          <span className="num">{Math.abs(delta.value).toFixed(delta.value % 1 ? 1 : 0)}%</span>
          <span className={dark ? "text-on-dark-3" : "text-muted"}>{delta.label}</span>
        </div>
      )}
      {spark && spark.length > 1 && <Sparkline values={spark} className="spark" stroke={dark ? "var(--dk-sand-500)" : "var(--dk-green-500)"} />}
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

export function StatGrid({ children, cols = 4 }: { children: ReactNode; cols?: 2 | 3 | 4 | 5 | 6 }) {
  const map: Record<number, string> = {
    2: "grid-cols-2",
    3: "grid-cols-2 md:grid-cols-3",
    4: "grid-cols-2 md:grid-cols-4",
    5: "grid-cols-2 md:grid-cols-3 xl:grid-cols-5",
    6: "grid-cols-2 md:grid-cols-3 xl:grid-cols-6",
  };
  return <div className={`grid gap-3 ${map[cols]}`}>{children}</div>;
}

export function Progress({ value, tone, onDark }: { value: number; tone?: "warn" | "danger" | "sand"; onDark?: boolean }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className={`bar ${onDark ? "on-dark" : ""}`} role="progressbar" aria-valuenow={Math.round(v)} aria-valuemin={0} aria-valuemax={100}>
      <i className={tone ?? ""} style={{ width: `${v}%` }} />
    </div>
  );
}
