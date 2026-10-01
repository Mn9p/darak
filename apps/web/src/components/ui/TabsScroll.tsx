"use client";

import { useEffect, useRef } from "react";

/** Keeps the active tab visible when the tab strip scrolls sideways (phones, many tabs). */
export function TabsScroll() {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const strip = ref.current?.parentElement;
    const active = strip?.querySelector<HTMLElement>(".tab.active");
    if (!strip || !active || strip.scrollWidth <= strip.clientWidth) return;
    const s = strip.getBoundingClientRect();
    const a = active.getBoundingClientRect();
    if (a.left < s.left || a.right > s.right) strip.scrollBy({ left: a.left + a.width / 2 - (s.left + s.width / 2) });
  });
  return <span ref={ref} hidden />;
}
