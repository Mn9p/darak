"use client";

import { useState } from "react";

/** Read-only value with a copy button (the MCP link, a CLI command). */
export function CopyField({ value, label = "نسخ" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-stretch gap-2">
      <code className="latin min-w-0 flex-1 truncate rounded-xl border border-line bg-mist px-3 py-2 text-[13px] text-text" dir="ltr" title={value}>
        {value}
      </code>
      <button
        type="button"
        className="btn btn-outline btn-sm shrink-0"
        onClick={() => {
          navigator.clipboard?.writeText(value).then(
            () => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1800);
            },
            () => {},
          );
        }}
      >
        {copied ? "تم النسخ" : label}
      </button>
    </div>
  );
}
