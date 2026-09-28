"use client";

export function PrintButton({ label = "طباعة الإيصال" }: { label?: string }) {
  return (
    <button type="button" className="btn btn-primary btn-sm no-print" onClick={() => window.print()}>
      {label}
    </button>
  );
}
