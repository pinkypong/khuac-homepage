import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "KHUAC | 경희대학교 산악부",
  description: "경희대학교 산악부 산행 지도와 활동 앨범",
  appleWebApp: { capable: true, title: "KHUAC", statusBarStyle: "default" },
};

// viewport-fit=cover is what makes env(safe-area-inset-*) report anything
// other than zero, and the layouts anchored to a screen edge - the map's tab
// bar, the lightbox - are built around it. It matters in the iOS WKWebView
// shell, where the page really does run under the notch and home indicator.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
