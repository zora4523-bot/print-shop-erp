'use client';

import { Fragment } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';

// 固定段名 → 中文标签。匹配不到的段（如 [id] 这类）直接回落到原 segment
// 字符串显示。新增顶层导航时同步更新。
const SEGMENT_LABELS: Record<string, string> = {
  owner: '老板后台',
  foreman: '车间',
  sales: '销售',
  'customer-service': '客服',
  worker: '师傅',
  orders: '工单',
  bills: '账单',
  accounts: '账号管理',
  crafts: '工艺',
  products: '产品',
  salary: '薪资',
  daily: '师傅日薪',
  hourly: '时薪工月结',
  cs: '客服周期',
  scheduling: '排产',
  outsource: '外协',
  attendance: '工时',
  account: '账户',
  password: '修改密码',
  new: '新建',
};

// Routes that are layout-only (no page.tsx) — linking them produces
// 404s. Render those segments as text instead. Codex round 78 / P2.
// Keep this in sync with the file tree in `app/`; if a layout-only
// shell becomes a real page, drop the entry here.
const LAYOUT_ONLY_PATHS = new Set<string>([
  '/owner',
  '/foreman',
  '/sales',
]);

function labelFor(segment: string): string {
  return SEGMENT_LABELS[segment] ?? segment;
}

export function AdminBreadcrumb() {
  const pathname = usePathname();
  const segments = pathname.split('/').filter(Boolean);

  if (segments.length === 0) {
    return (
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbPage>首页</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
    );
  }

  return (
    <Breadcrumb>
      <BreadcrumbList>
        {segments.map((seg, i) => {
          const isLast = i === segments.length - 1;
          const href = '/' + segments.slice(0, i + 1).join('/');
          // Layout-only paths can't be navigated to (404)；render the
          // label as text not link. Codex round 78 / P2.
          const isLinkable = !LAYOUT_ONLY_PATHS.has(href);
          return (
            // Separator must be a SIBLING of BreadcrumbItem, not a
            // child — both render `<li>`, and `<li>` inside `<li>` is
            // invalid DOM. Codex round 78 / P2.
            <Fragment key={href}>
              <BreadcrumbItem>
                {isLast ? (
                  // Real terminal — semantically "current page".
                  <BreadcrumbPage>{labelFor(seg)}</BreadcrumbPage>
                ) : isLinkable ? (
                  // shadcn 这套 BreadcrumbLink 用 @base-ui/react 的
                  // useRender，不接受 Radix 的 asChild —— 走 render
                  // prop 把 <a> 替换成 next/link。
                  <BreadcrumbLink render={<Link href={href} />}>
                    {labelFor(seg)}
                  </BreadcrumbLink>
                ) : (
                  // Layout-only ancestor: not navigable AND not the
                  // current page. Plain <span>, no aria-current —
                  // BreadcrumbPage would hard-code aria-current="page"
                  // and screen readers would announce two "current"s
                  // on a single breadcrumb (Codex round 81 / P3).
                  <span className="text-muted-foreground">
                    {labelFor(seg)}
                  </span>
                )}
              </BreadcrumbItem>
              {!isLast && <BreadcrumbSeparator />}
            </Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
