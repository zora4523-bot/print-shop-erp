import type { Metadata, Viewport } from "next";
import { Geist_Mono } from "next/font/google";
import "./globals.css";

// 正文走跨平台系统 UI 无衬线字体栈（globals.css --font-sans）；
// Geist Mono 仅用于日志、配置键和原始技术标识；业务数字使用系统 UI
// 字体配合 tabular-nums，避免斜线零并保持表格数字对齐。
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "红包印刷 ERP",
  description: "红包印刷厂内部管理系统",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // Metadata cannot resolve CSS custom properties. Canvas is the semantic CSS
  // system color for the document background, so this does not duplicate a
  // palette literal. The app has no product-level dark-mode switch yet.
  themeColor: "Canvas",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-CN"
      className={`${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
