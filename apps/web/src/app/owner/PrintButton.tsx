"use client";

export function PrintButton({ label = "طباعة", className = "btn btn-outline btn-sm" }: { label?: string; className?: string }) {
  return (
    <button type="button" className={`${className} no-print`} onClick={() => window.print()}>
      {label}
    </button>
  );
}
