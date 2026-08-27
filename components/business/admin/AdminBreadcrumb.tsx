'use client';

import { Fragment, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useBreadcrumbEntityLabel } from './breadcrumb-entity';
import { ADMIN_MODULES } from '@/lib/navigation/admin-modules';
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
  owner: '管理后台',
  foreman: '生产管理',
  sales: '销售',
  'customer-service': '客服',
  worker: '师傅',
  orders: '工单',
  purchases: '采购单',
  bills: '账单',
  accounts: '账号管理',
  parties: '客户/供应商',
  crafts: '工艺',
  products: '产品',
  'product-categories': '产品分类',
  boms: 'BOM/用料',
  materials: '物料',
  warehouses: '仓库/库位',
  'customer-pricing': '客户计价规则',
  'pricing-routes': '计价方式',
  papers: '纸张',
  'stock-skus': '现货 SKU',
  'price-versions': '价格版本',
  'internal-pricing': '内部计价',
  'worker-piecework': '师傅计件规则',
  'employee-pay': '员工工资与提成',
  prices: '价格管理',
  'external-sales': '客户计价规则',
  items: '规则工作台',
  versions: '价格版本',
  quote: '报价查询',
  adjustments: '加价规则',
  tiers: '价格阶梯',
  notifications: '推送配置',
  pigsty: 'Pigsty 运维',
  salary: '薪资',
  daily: '计件工资',
  'piecework-rules': '计件规则',
  hourly: '时薪工月结',
  cs: '客服周期',
  scheduling: '排产',
  outsource: '外协',
  attendance: '工时',
  account: '账户',
  password: '修改密码',
  new: '新建',
  edit: '编辑',
  count: '盘点',
};

// 有些路由在不同业务下会复用同一末级段名（例如
// `/owner/rules` 与 `/owner/salary/rules`）。这些标签必须按完整累计路径
// 解析，不能仅依赖 segment，否则会把旧的工资规则误标为规则中心。
export const BREADCRUMB_PATH_LABELS: Readonly<Record<string, string>> = {
  '/owner/rules': '规则配置中心',
  '/owner/rules/pricing-routes': '计价方式',
  '/owner/rules/papers': '纸张',
  '/owner/rules/stock-skus': '报价 SKU',
  '/owner/rules/product-categories': '产品结构分类',
  '/owner/rules/crafts': '工艺与参数',
  '/owner/rules/customer-pricing': '客户计价规则',
  '/owner/rules/price-versions': '价格版本',
  '/owner/rules/internal-pricing': '内部计价',
  '/owner/rules/worker-piecework': '师傅计件规则',
  '/owner/rules/employee-pay': '员工工资与提成',
  '/owner/salary/rules': '员工工资规则',
};

// Routes that are layout-only (no page.tsx) — linking them produces
// 404s. Render those segments as text instead。
// Keep this in sync with the file tree in `app/`; if a layout-only
// shell becomes a real page, drop the entry here.
const LAYOUT_ONLY_PATHS = new Set<string>([
  '/foreman',
  '/sales',
  '/owner/prices/adjustments',
  '/owner/prices/tiers',
  '/owner/rules/internal-pricing/adjustments',
  '/owner/rules/internal-pricing/tiers',
]);

// cuid（Prisma @default(cuid())）/ uuid 形态的路径段。这类段没有可读
// 标签，把 25 位随机串印在面包屑上等于什么都没说。
const ID_SEGMENT =
  /^(c[a-z0-9]{20,}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

// 导出供单测直接调用：给定段名 + 详情页交上来的业务编号，算出显示什么。
function labelFromModules(segment: string): string | undefined {
  const labels = new Set<string>();
  for (const adminModule of ADMIN_MODULES) {
    if (adminModule.routeBase === '#') continue;
    const last = adminModule.routeBase.split('/').filter(Boolean).at(-1);
    if (last === segment) labels.add(adminModule.breadcrumbLabel);
  }
  return labels.size === 1 ? [...labels][0] : undefined;
}

export function resolveSegmentLabel(
  segment: string,
  entityLabel: string | null,
  pageHeading?: string | null,
): string {
  const fromModule = labelFromModules(segment);
  if (fromModule) return fromModule;
  const known = SEGMENT_LABELS[segment];
  if (known) return known;
  if (ID_SEGMENT.test(segment)) return entityLabel ?? pageHeading ?? '详情';
  return pageHeading ?? '页面';
}

function subscribePageHeading(listener: () => void) {
  const root = document.querySelector('#admin-main');
  if (!root) return () => undefined;
  const observer = new MutationObserver(listener);
  observer.observe(root, { childList: true, subtree: true, characterData: true });
  return () => observer.disconnect();
}

function getPageHeadingSnapshot(): string | null {
  return document.querySelector('#admin-main h1')?.textContent?.trim() || null;
}

function getPageHeadingServerSnapshot(): null {
  return null;
}

export function AdminBreadcrumb() {
  const pathname = usePathname();
  // 详情页通过 <BreadcrumbEntity> 把已经查出来的业务编号交上来，
  // 这里不发任何请求。
  const entityLabel = useBreadcrumbEntityLabel();
  const pageHeading = useSyncExternalStore(
    subscribePageHeading,
    getPageHeadingSnapshot,
    getPageHeadingServerSnapshot,
  );
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
    <Breadcrumb className="min-w-0 overflow-hidden">
      <BreadcrumbList className="w-full min-w-0 flex-nowrap overflow-hidden whitespace-nowrap">
        {segments.map((seg, i) => {
          const isLast = i === segments.length - 1;
          const href = '/' + segments.slice(0, i + 1).join('/');
          const label =
            BREADCRUMB_PATH_LABELS[href] ??
            resolveSegmentLabel(
              seg,
              entityLabel,
              isLast ? pageHeading : null,
            );
          // Layout-only paths can't be navigated to (404)；render the
          // label as text not link。
          const isLinkable = !LAYOUT_ONLY_PATHS.has(href);
          return (
            // Separator must be a SIBLING of BreadcrumbItem, not a
            // child — both render `<li>`, and `<li>` inside `<li>` is
            // invalid DOM。
            <Fragment key={href}>
              <BreadcrumbItem
                className={
                  isLast
                    ? 'min-w-0 flex-1'
                    : i === 0
                      ? 'hidden shrink-0 lg:inline-flex'
                      : 'hidden shrink-0 2xl:inline-flex'
                }
              >
                {isLast ? (
                  // Real terminal — semantically "current page".
                  <BreadcrumbPage
                    className="block max-w-[min(42vw,24rem)] truncate"
                    title={label}
                  >
                    {label}
                  </BreadcrumbPage>
                ) : isLinkable ? (
                  // shadcn 这套 BreadcrumbLink 用 @base-ui/react 的
                  // useRender，不接受 Radix 的 asChild —— 走 render
                  // prop 把 <a> 替换成 next/link。
                  <BreadcrumbLink
                    render={<Link href={href} prefetch={false} />}
                  >
                    {label}
                  </BreadcrumbLink>
                ) : (
                  // Layout-only ancestor: not navigable AND not the
                  // current page. Plain <span>, no aria-current —
                  // BreadcrumbPage would hard-code aria-current="page"
                  // and screen readers would announce two "current"s
                  // on a single breadcrumb .
                  <span className="text-muted-foreground">
                    {label}
                  </span>
                )}
              </BreadcrumbItem>
              {!isLast && (
                <BreadcrumbSeparator
                  className={
                    i === 0
                      ? 'hidden shrink-0 lg:block'
                      : 'hidden shrink-0 2xl:block'
                  }
                />
              )}
            </Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
