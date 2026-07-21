import type { Metadata, Viewport } from "next";
import { Geist_Mono } from "next/font/google";
import Script from "next/script";
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
  // system color for the active document theme, so this does not duplicate a
  // palette literal.
  themeColor: "Canvas",
};

const themeBootstrap = `(() => {
  try {
    const stored = localStorage.getItem('erp-theme');
    const theme = stored === 'light' || stored === 'dark' ? stored : 'system';
    const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.toggle('dark', dark);
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
  } catch {}
})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-CN"
      className={`${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <Script id="erp-theme-bootstrap" strategy="beforeInteractive">
          {themeBootstrap}
        </Script>
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
