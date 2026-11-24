import type { Metadata, Viewport } from "next";
import "@fontsource/ibm-plex-sans-arabic/400.css";
import "@fontsource/ibm-plex-sans-arabic/500.css";
import "@fontsource/ibm-plex-sans-arabic/600.css";
import "@fontsource/tajawal/400.css";
import "@fontsource/tajawal/500.css";
import "@fontsource/tajawal/700.css";
import "./globals.css";

export const metadata: Metadata = { title: { default: "AoosGPT | مساعدك للأعمال الحكومية", template: "%s | AoosGPT" }, description: "مساحة عربية لإدارة أعمال المنشأة، والمستندات، والمتابعة، والمحادثة مع AoosGPT.", icons: { icon: { url: "/icon.svg", type: "image/svg+xml" } }, robots: { index: false, follow: false } };
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#0A1511" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="ar" dir="rtl"><body>{children}</body></html>; }
