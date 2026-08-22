// Minimal top-level layout for /print/* routes. No navbar, no padding,
// no shared chrome — whatever lands here is meant to be rendered onto
// paper (or captured verbatim by Puppeteer for PDF). Keeping /print as
// a separate root segment avoids inheriting /orders' nav header.
//
// 主题隔离**不在这里**做：next/script 的 beforeInteractive 只在根 layout
// 生效，放在嵌套 layout 里不但不执行，还会报「Encountered a script tag
// while rendering React component」。改由 OrderPrintLayout 的 PRINT_CSS
// 直接覆盖 body 背景/前景——那份 style 只在打印路由注入，作用域是安全的。
export default function PrintLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
