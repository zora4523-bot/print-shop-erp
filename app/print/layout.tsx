// Minimal top-level layout for /print/* routes. No navbar, no padding,
// no shared chrome — whatever lands here is meant to be rendered onto
// paper (or captured verbatim by Puppeteer for PDF). Keeping /print as
// a separate root segment avoids inheriting /orders' nav header.
export default function PrintLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
