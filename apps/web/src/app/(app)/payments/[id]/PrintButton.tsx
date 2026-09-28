"use client";

export function PrintButton() {
  return (
    <button type="button" className="btn btn-outline btn-sm no-print" onClick={() => window.print()}>
      طباعة الإيصال
    </button>
  );
}
