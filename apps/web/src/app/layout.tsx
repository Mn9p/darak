import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { IBM_Plex_Sans_Arabic, Inter } from "next/font/google";
import "./globals.css";

// Brand type (brand/DARAK_Brand_Identity.html): IBM Plex Sans Arabic for text, Inter for numbers and Latin.
const plex = IBM_Plex_Sans_Arabic({
  subsets: ["arabic", "latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-plex",
  display: "swap",
});

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  title: { default: "دارك — إدارة أملاكك. بصورة أوضح.", template: "%s · دارك" },
  description: "منصة دارك لإدارة وتشغيل الأملاك العقارية — كل عقار. كل عقد. كل ريال. كل مهمة. في مكان واحد.",
  icons: { icon: "/favicon.svg" },
};

// viewport-fit=cover exposes the iPhone safe areas so the bottom bar can sit above the home indicator.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#FFFFFF",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Reading the request makes every page render per request, so each response carries its own CSP nonce (middleware.ts);
  // a page prerendered at build time would ship scripts without the nonce and be blocked.
  await headers();
  return (
    <html lang="ar" dir="rtl" className={`${plex.variable} ${inter.variable}`}>
      <body>{children}</body>
    </html>
  );
}
