import type { Metadata } from "next";
import { Geist_Mono } from "next/font/google";
import "./globals.css";

// 正文走系统苹方字体栈（globals.css --font-sans），无需网络字体；
// 等宽字体保留 Geist Mono，工单号 / 金额列用。
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "红包印刷 ERP",
  description: "红包印刷厂内部管理系统",
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
