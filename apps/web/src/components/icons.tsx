// Minimal line-icon set (24px grid, stroke 1.8) — consistent with the brand's calm, geometric mark.
import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { size?: number };
const base = (size: number, p: P) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  ...p,
});

export const Icons = {
  home: ({ size = 18, ...p }: P) => (
    <svg {...base(size, p)}>
      <path d="M3 11.5 12 4l9 7.5" />
      <path d="M5 10v10h14V10" />
      <path d="M10 20v-6h4v6" />
    </svg>
  ),
  building: ({ size = 18, ...p }: P) => (
    <svg {...base(size, p)}>
      <rect x="4" y="3" width="16" height="18" rx="1.5" />
      <path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2M10 21v-3h4v3" />
    </svg>
  ),
  door: ({ size = 18, ...p }: P) => (
    <svg {...base(size, p)}>
      <path d="M6 21V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v17" />
      <path d="M3 21h18" />
      <circle cx="14.5" cy="12.5" r=".9" fill="currentColor" />
    </svg>
  ),
  users: ({ size = 18, ...p }: P) => (
    <svg {...base(size, p)}>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 19a5.5 5.5 0 0 1 11 0" />
      <circle cx="17" cy="9.5" r="2.4" />
      <path d="M15.5 19a4.5 4.5 0 0 1 5-4.2" />
    </svg>
  ),
  user: ({ size = 18, ...p }: P) => (
    <svg {...base(size, p)}>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20a7 7 0 0 1 14 0" />
    </svg>
  ),
  key: ({ size = 18, ...p }: P) => (
    <svg {...base(size, p)}>
      <circle cx="8" cy="12" r="4" />
      <path d="M12 12h9M18 12v3M15 12v2" />
    </svg>
  ),
  file: ({ size = 18, ...p }: P) => (
    <svg {...base(size, p)}>
      <path d="M7 3h7l5 5v13H7z" />
      <path d="M14 3v5h5M10 13h6M10 17h6" />
    </svg>
  ),
  coins: ({ size = 18, ...p }: P) => (
    <svg {...base(size, p)}>
      <ellipse cx="12" cy="6.5" rx="7" ry="3" />
      <path d="M5 6.5v5c0 1.7 3.1 3 7 3s7-1.3 7-3v-5" />
      <path d="M5 11.5v5c0 1.7 3.1 3 7 3s7-1.3 7-3v-5" />
    </svg>
  ),
  receipt: ({ size = 18, ...p }: P) => (
    <svg {...base(size, p)}>
      <path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" />
      <path d="M9 8h6M9 12h6" />
    </svg>
  ),
  wallet: ({ size = 18, ...p }: P) => (
    <svg {...base(size, p)}>
      <rect x="3" y="6" width="18" height="13" rx="2" />
      <path d="M3 10h18M16 14h2" />
    </svg>
  ),
  check: ({ size = 18, ...p }: P) => (
    <svg {...base(size, p)}>
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </svg>
  ),
  tasks: ({ size = 18, ...p }: P) => (
    <svg {...base(size, p)}>
      <path d="m4 7 2 2 3-3M4 13l2 2 3-3M4 19l2 2 3-3M12 7h8M12 13h8M12 19h8" />
    </svg>
  ),
  chart: ({ size = 18, ...p }: P) => (
    <svg {...base(size, p)}>
      <path d="M4 20h16M7 16v-5M12 16V7M17 16v-9" />
    </svg>
  ),
  bell: ({ size = 18, ...p }: P) => (
    <svg {...base(size, p)}>
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  ),
  folder: ({ size = 18, ...p }: P) => (
    <svg {...base(size, p)}>
      <path d="M3 6h6l2 2h10v11H3z" />
    </svg>
  ),
  clock: ({ size = 18, ...p }: P) => (
    <svg {...base(size, p)}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </svg>
  ),
  sparkle: ({ size = 18, ...p }: P) => (
    <svg {...base(size, p)}>
      <path d="M12 3.5c.6 3.9 2.6 5.9 6.5 6.5-3.9.6-5.9 2.6-6.5 6.5-.6-3.9-2.6-5.9-6.5-6.5 3.9-.6 5.9-2.6 6.5-6.5z" />
      <path d="M18.5 15.5c.3 1.6 1 2.3 2.5 2.5-1.5.3-2.2 1-2.5 2.5-.3-1.5-1-2.2-2.5-2.5 1.5-.2 2.2-.9 2.5-2.5z" />
    </svg>
  ),
  plug: ({ size = 18, ...p }: P) => (
    <svg {...base(size, p)}>
      <path d="M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0zM12 17v4" />
    </svg>
  ),
  settings: ({ size = 18, ...p }: P) => (
    <svg {...base(size, p)}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </svg>
  ),
  help: ({ size = 18, ...p }: P) => (
    <svg {...base(size, p)}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .8-1 1.5V14M12 17h.01" />
    </svg>
  ),
  upload: ({ size = 18, ...p }: P) => (
    <svg {...base(size, p)}>
      <path d="M12 16V4M7 9l5-5 5 5M4 20h16" />
    </svg>
  ),
  search: ({ size = 18, ...p }: P) => (
    <svg {...base(size, p)}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-4.2-4.2" />
    </svg>
  ),
  handshake: ({ size = 18, ...p }: P) => (
    <svg {...base(size, p)}>
      <path d="m3 10 4-4 5 2 5-2 4 4-3 6-3 3-3-1-3 1-3-3z" />
      <path d="m9 12 3 3 3-3" />
    </svg>
  ),
  bank: ({ size = 18, ...p }: P) => (
    <svg {...base(size, p)}>
      <path d="M3 9.5 12 4l9 5.5H3zM5 10v7M9.5 10v7M14.5 10v7M19 10v7M3 20h18" />
    </svg>
  ),
  plus: ({ size = 18, ...p }: P) => (
    <svg {...base(size, p)}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  ),
  chevron: ({ size = 18, ...p }: P) => (
    <svg {...base(size, p)}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  ),
  alert: ({ size = 18, ...p }: P) => (
    <svg {...base(size, p)}>
      <path d="M12 3 2.5 20h19z" />
      <path d="M12 9v5M12 17h.01" />
    </svg>
  ),
  grid: ({ size = 18, ...p }: P) => (
    <svg {...base(size, p)}>
      <rect x="4" y="4" width="6.5" height="6.5" rx="1.5" />
      <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5" />
      <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5" />
      <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5" />
    </svg>
  ),
  close: ({ size = 18, ...p }: P) => (
    <svg {...base(size, p)}>
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  ),
  logout: ({ size = 18, ...p }: P) => (
    <svg {...base(size, p)}>
      <path d="M14 4h5a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-5" />
      <path d="M10 8l-4 4 4 4M6 12h10" />
    </svg>
  ),
  shield: ({ size = 18, ...p }: P) => (
    <svg {...base(size, p)}>
      <path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.2 7.5 9.5 4.3-1.3 7.5-4.9 7.5-9.5V6z" />
      <path d="m9 12 2.2 2.2L15.5 10" />
    </svg>
  ),
  phone: ({ size = 18, ...p }: P) => (
    <svg {...base(size, p)}>
      <path d="M5 4h3.5l1.5 4-2 1.5a11 11 0 0 0 6.5 6.5l1.5-2 4 1.5V19a1.5 1.5 0 0 1-1.5 1.5A15.5 15.5 0 0 1 3.5 5.5 1.5 1.5 0 0 1 5 4z" />
    </svg>
  ),
};

export type IconName = keyof typeof Icons;

export function Icon({ name, size, className }: { name: IconName; size?: number; className?: string }) {
  const C = Icons[name];
  return <C size={size} className={className} />;
}
