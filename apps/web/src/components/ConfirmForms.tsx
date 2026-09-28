"use client";

import { useEffect } from "react";

/** Intercepts submits of any <form data-confirm="..."> and asks the user first. */
export function ConfirmForms() {
  useEffect(() => {
    const h = (e: Event) => {
      const form = e.target as HTMLFormElement | null;
      const msg = form?.getAttribute?.("data-confirm");
      if (msg && !window.confirm(msg)) e.preventDefault();
    };
    document.addEventListener("submit", h, true);
    return () => document.removeEventListener("submit", h, true);
  }, []);
  return null;
}
