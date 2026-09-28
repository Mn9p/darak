import type { ReactNode } from "react";
import { LogoMark } from "./Logo";

/**
 * Shared header for printable documents (receipts, owner statements, reports).
 * Logo + wordmark + office name on one side; document title, number and date on the other.
 * Closed by a thin sand rule — the only "premium" accent on the page.
 */
export function PrintHeader({
  orgName,
  orgMeta,
  title,
  code,
  date,
  extra,
}: {
  orgName: string;
  /** Secondary office line: city · phone · CR / VAT */
  orgMeta?: ReactNode;
  title: string;
  code?: string;
  date?: string;
  /** Optional node under the date (e.g. a status tag) */
  extra?: ReactNode;
}) {
  return (
    <div className="print-header mb-5 border-b-2 border-sand pb-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <LogoMark size={44} />
          <div className="leading-tight">
            <div className="flex items-baseline gap-2">
              <b className="text-[22px] text-ink">دارك</b>
              <span className="text-[13px] text-muted">·</span>
              <span className="text-[14px] font-bold text-text">{orgName}</span>
            </div>
            {orgMeta && <div className="mt-0.5 text-[12px] text-muted">{orgMeta}</div>}
          </div>
        </div>
        <div className="text-left">
          <h2 className="text-[17px] font-bold text-brand">{title}</h2>
          {code && <div className="latin text-[13px] font-semibold text-text">{code}</div>}
          {date && <div className="num text-[12px] text-muted">{date}</div>}
          {extra && <div className="mt-1">{extra}</div>}
        </div>
      </div>
    </div>
  );
}

const PRINT_CSS = `
@media print {
  aside, header, nav, .no-print { display: none !important; }
  main { padding: 0 !important; }
  body { background: #fff !important; }
  .card, .print-sheet { box-shadow: none !important; border: none !important; }
  .print-header { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  @page { size: A4; margin: 14mm; }
}`;

/** Injects the print rules that hide the app chrome (sidebar, header) and keep the page white. */
export function PrintStyles() {
  return <style dangerouslySetInnerHTML={{ __html: PRINT_CSS }} />;
}
