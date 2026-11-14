import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

const font = Plus_Jakarta_Sans({ variable: "--font-app", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "CardKeep – Scan Visiting Cards",
  description: "Snap a business card, review the details, and save straight to your phone and Google Contacts.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "CardKeep", statusBarStyle: "default" },
  icons: { icon: "/icon.svg", apple: "/icon-192.png" },
};

export const viewport: Viewport = {
  themeColor: "#1d4ed8",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${font.variable} antialiased`}>{children}</body>
    </html>
  );
}
