'use client';

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
          return (
            <BreadcrumbItem key={href}>
              {isLast ? (
                <BreadcrumbPage>{labelFor(seg)}</BreadcrumbPage>
              ) : (
                <>
                  {/* shadcn 这套 BreadcrumbLink 用 @base-ui/react 的
                      useRender，不接受 Radix 的 asChild —— 走 render
                      prop 把 <a> 替换成 next/link，写法与 AppSidebar
                      的 SidebarMenuButton 保持一致。 */}
                  <BreadcrumbLink render={<Link href={href} />}>
                    {labelFor(seg)}
                  </BreadcrumbLink>
                  <BreadcrumbSeparator />
                </>
              )}
            </BreadcrumbItem>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
