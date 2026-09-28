import type { Metadata } from "next";
import { headers } from "next/headers";
import { IBM_Plex_Sans_Arabic, Inter } from "next/font/google";
import "./globals.css";

const plex = IBM_Plex_Sans_Arabic({
  subsets: ["arabic", "latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-plex",
  display: "swap",
});

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  title: { default: "دارك — إدارة أملاكك. بصورة أوضح.", template: "%s · دارك" },
  description: "منصة دارك لإدارة وتشغيل الأملاك العقارية — كل عقار. كل عقد. كل ريال. كل مهمة. في مكان واحد.",
  icons: { icon: "/favicon.svg" },
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
