"use client";

export function PrintButton({ className = "btn btn-outline btn-sm" }: { className?: string }) {
  return (
    <button type="button" className={`${className} no-print`} onClick={() => window.print()}>
      طباعة الكشف
    </button>
  );
}
