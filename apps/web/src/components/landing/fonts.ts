import localFont from "next/font/local";

/**
 * thmanyah typeface for the landing page only (files in src/fonts/thmanyah, licensed by thmanyah Publishing & Distribution):
 * Sans for text and interface, Serif Display for headlines. The product itself keeps IBM Plex Sans Arabic (layout.tsx).
 * Numbers stay in Inter through the .num / --font-latin rules in globals.css.
 */
export const thmanyahSans = localFont({
  src: [
    { path: "../../fonts/thmanyah/thmanyahsans-Regular.woff2", weight: "400", style: "normal" },
    { path: "../../fonts/thmanyah/thmanyahsans-Medium.woff2", weight: "500", style: "normal" },
    { path: "../../fonts/thmanyah/thmanyahsans-Bold.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-thmanyah-sans",
  display: "swap",
  fallback: ["IBM Plex Sans Arabic", "Noto Sans Arabic", "Tahoma", "Arial", "sans-serif"],
});

export const thmanyahDisplay = localFont({
  src: [
    { path: "../../fonts/thmanyah/thmanyahserifdisplay-Regular.woff2", weight: "400", style: "normal" },
    { path: "../../fonts/thmanyah/thmanyahserifdisplay-Medium.woff2", weight: "500", style: "normal" },
    { path: "../../fonts/thmanyah/thmanyahserifdisplay-Bold.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-thmanyah-display",
  display: "swap",
  fallback: ["IBM Plex Sans Arabic", "Noto Naskh Arabic", "serif"],
});
