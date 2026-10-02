'use client';

import { Fragment, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { useBreadcrumbEntityLabel, useBreadcrumbParent } from './breadcrumb-entity';
import { PendingLink } from '@/components/ui-business';
import { ADMIN_MODULES } from '@/lib/navigation/admin-modules';
import type { Role } from '@/generated/prisma/enums';
import { RULE_CENTER_SIDEBAR_ITEMS } from '@/lib/navigation/rule-center';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';

// 固定段名 → 中文标签。名称与侧栏、H1、<title> 同源（ui-规范 §8.3）。
// 新增顶层导航时同步更新；漏登记会被路由遍历单测拦下。
const SEGMENT_LABELS: Record<string, string> = {
  owner: '管理后台',
  workbench: '工作台',
  foreman: '生产管理',
  sales: '销售',
  overview: '我的总览',
  worker: '师傅',
  orders: '工单列表',
  purchases: '采购单',
  bills: '账单',
  accounts: '用户管理',
  parties: '客户/供应商',
  crafts: '工艺',
  'items': '产品资料',
  'product-categories': '产品分类',
  boms: '用料清单',
  materials: '物料',
  warehouses: '仓库/库位',
  'customer-pricing': '客户计价规则',
  papers: '纸张',
  specifications: '规格目录',
  'stock-skus': '空白封单价',
  'price-versions': '价格版本',
  'employee-pay': '员工薪酬规则',
  prices: '价格管理',
  'external-sales': '客户计价规则',
  adjustments: '加价规则',
  tiers: '价格阶梯',
  notifications: '推送配置',
  attention: '关注事项',
  analytics: '经营概览',
  cdr: 'CDR 汇总',
  'order-changes': '工单修改申请',
  pigsty: 'Pigsty 运维',
  salary: '薪资',
  daily: '历史日薪档案',
  piecework: '工序计件结算',
  hourly: '历史时薪档案',
  scheduling: '排产',
  outsource: '外协',
  attendance: '工时录入',
  account: '账户',
  password: '修改密码',
  new: '新建',
  edit: '编辑',
  count: '盘点',
  archive: '历史账单归档',
};

// 规则中心的子页使用完整路径标签，避免同名 segment 在不同
// 业务层级中回落到模糊的通用文案。
export const BREADCRUMB_PATH_LABELS: Readonly<Record<string, string>> =
  {
    ...Object.fromEntries(
      RULE_CENTER_SIDEBAR_ITEMS.map((item) => [item.href, item.breadcrumbLabel]),
    ),
    '/owner/rules/customer-pricing/blank': '空白封单价',
    '/owner/rules/customer-pricing/blank/new': '新建纸张与规格价格',
    // '/orders' 不在此固定：管理员「工单列表」与外部销售「我的工单」按角色从模块表取。
    '/orders/new': '新建工单',
    '/owner/agent-bills/unbilled': '未出账工单',
    // 兼容别名，redirect 到 /owner/agent-bills；历史账单归档的父级按落点命名。
    '/owner/bills': '外部销售月账单',
    '/owner/bills/archive': '历史账单归档',
    '/owner/materials/count': '库存盘点',
    '/orders/production': '安排生产师傅',
    '/owner/purchases/new': '新建采购单',
    '/owner/accounts/new': '新建账号',
    '/owner/boms/new': '新建用料清单',
    '/owner/materials/new': '新建物料',
    '/owner/parties/new': '新建客户/供应商',
    '/owner/rules/papers/new': '新建纸张',
    '/owner/rules/crafts/new': '新建工艺',
    '/owner/rules/product-categories/new': '新建产品结构分类',
    '/owner/rules/product-categories/items/new': '新建产品资料',
    '/foreman/outsource/new': '新建外协单',
    '/foreman/materials/new': '新建物料',
    '/owner/notifications/channels/new': '新建通知目标',
  };

// Routes that are layout-only (no page.tsx) — linking them produces
// 404s. Render those segments as text instead。
// Keep this in sync with the file tree in `app/`; if a layout-only
// shell becomes a real page, drop the entry here. 单测会遍历 app 下的
// page 路由，发现可点击祖先没有 page 时直接失败。
const LAYOUT_ONLY_PATHS: ReadonlySet<string> = new Set<string>([
  '/foreman',
  '/sales',
  '/owner/prices',
  '/owner/rules/customer-pricing/blank',
]);

// 纯分组段：既无页面、也没有独立业务含义（通知目标 / 事件规则都在
// 「推送配置」一页里维护）。面包屑直接跳过，父级就是推送配置。
const SKIPPED_BREADCRUMB_PATHS: ReadonlySet<string> = new Set<string>([
  '/owner/notifications/channels',
  '/owner/notifications/rules',
]);

// 非 cuid 形态的动态段（如事件名）：按父路径给出服务端可确定的默认
// 标签，详情页交上业务名后再替换，不再读 h1 回落。
const DYNAMIC_CHILD_LABELS: Readonly<Record<string, string>> = {
  '/owner/notifications/rules': '事件规则',
  '/owner/notifications/channels': '通知目标',
};

// cuid（Prisma @default(cuid())）/ uuid 形态的路径段。这类段没有可读
// 标签，把 25 位随机串印在面包屑上等于什么都没说。
const ID_SEGMENT =
  /^(c[a-z0-9]{20,}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

// 导出供单测直接调用：给定段名 + 详情页交上来的业务编号，算出显示什么。
// 同一路径被多个角色的模块登记时（/orders：管理员「工单列表」、外部销售「我的工单」），
// 按当前角色取自己侧栏里的那个名字，保证侧栏、面包屑、H1、<title> 同源（§8.3）。
function labelFromModules(path: string, role?: Role): string | undefined {
  const matches = ADMIN_MODULES.filter(
    (adminModule) => adminModule.routeBase !== '#' && adminModule.routeBase === path,
  );
  const own = role ? matches.filter((adminModule) => adminModule.menuRoles.includes(role)) : [];
  const labels = new Set((own.length > 0 ? own : matches).map((adminModule) => adminModule.breadcrumbLabel));
  return labels.size === 1 ? [...labels][0] : undefined;
}

/**
 * 段标签解析。返回 null 表示服务端无法确定（未登记的静态段），
 * 调用方只在末级用页面 H1 兜底；不再回落到无意义的「页面」。
 */
export function resolveSegmentLabel(
  segment: string,
  entityLabel: string | null,
  pageHeading?: string | null,
  path?: string,
  role?: Role,
): string | null {
  const fromModule = path ? BREADCRUMB_PATH_LABELS[path] ?? labelFromModules(path, role) : undefined;
  if (fromModule) return fromModule;
  if (segment === 'new' && path) {
    const parent = labelFromModules(path.slice(0, -4), role);
    if (parent) return `新建${parent}`;
  }
  const known = SEGMENT_LABELS[segment];
  if (known) return known;
  // id 段：首帧就用「详情」，详情页交上业务编号后替换；不读 h1，避免闪变。
  if (ID_SEGMENT.test(segment)) return entityLabel ?? '详情';
  if (path) {
    const parentPath = path.slice(0, path.lastIndexOf('/'));
    const dynamicDefault = DYNAMIC_CHILD_LABELS[parentPath];
    if (dynamicDefault) return entityLabel ?? dynamicDefault;
  }
  return pageHeading ?? null;
}

type BreadcrumbCrumb = {
  href: string;
  label: string;
  linkable: boolean;
  isLast: boolean;
};

/** 纯函数：路径 → 面包屑段。组件与路由遍历单测共用。 */
export function buildBreadcrumbCrumbs(
  pathname: string,
  entityLabel: string | null = null,
  pageHeading: string | null = null,
  role?: Role,
): BreadcrumbCrumb[] {
  const segments = pathname.split('/').filter(Boolean);
  const crumbs: BreadcrumbCrumb[] = [];
  segments.forEach((seg, i) => {
    const href = '/' + segments.slice(0, i + 1).join('/');
    const isLast = i === segments.length - 1;
    const isBillCredit = segments[0] === 'owner' && segments[1] === 'agent-bills' && segments[3] === 'credits';
    if (isBillCredit && (i === 3 || i === 4)) return;
    if (!isLast && SKIPPED_BREADCRUMB_PATHS.has(href)) return;
    const label =
      (isBillCredit && isLast ? '录入抵扣或补收' : undefined) ??
      BREADCRUMB_PATH_LABELS[href] ??
      // 工单 id 段显示工单名称（业主 2026-10-02：员工靠名称认单，工单号不重要），
      // 名称为空或首帧未交上来时回落「工单详情」，不显示工单号。
      (segments[0] === 'orders' && i === 1 && seg !== 'new' ? entityLabel ?? '工单详情' : undefined) ??
      resolveSegmentLabel(seg, entityLabel, isLast ? pageHeading : null, href, role);
    if (!label) return;
    crumbs.push({ href, label, linkable: !LAYOUT_ONLY_PATHS.has(href), isLast });
  });
  return crumbs;
}

/**
 * 页面经 BreadcrumbParent 交上来的父级地址：只接受同一路径加查询串 / hash
 * （列表筛选、页码、returnTo），换路径、外站或协议相对地址一律回落父级自身。
 */
export function resolveBreadcrumbParentHref(parentHref: string, override: string | null): string {
  if (!override || !override.startsWith('/') || override.startsWith('//')) return parentHref;
  let url: URL;
  try { url = new URL(override, 'https://breadcrumb.invalid'); } catch { return parentHref; }
  if (url.origin !== 'https://breadcrumb.invalid' || url.pathname !== parentHref) return parentHref;
  return `${url.pathname}${url.search}${url.hash}`;
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

export function AdminBreadcrumb({ role }: { role?: Role } = {}) {
  const pathname = usePathname();
  // 详情页通过 <BreadcrumbEntity> 把已经查出来的业务编号交上来，
  // 这里不发任何请求。
  const entityLabel = useBreadcrumbEntityLabel();
  const parentOverride = useBreadcrumbParent();
  const pageHeading = useSyncExternalStore(
    subscribePageHeading,
    getPageHeadingSnapshot,
    getPageHeadingServerSnapshot,
  );
  const crumbs = buildBreadcrumbCrumbs(pathname, entityLabel, pageHeading, role);

  if (crumbs.length === 0) {
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

  const parentIndex = crumbs.length - 2;
  // 窄屏：保留父级（倒数第二段）与末级；根段 lg 起显示，其它中间段 xl 起显示。
  const visibility = (i: number): string =>
    i >= parentIndex ? '' : i === 0 ? 'hidden lg:inline-flex' : 'hidden xl:inline-flex';

  return (
    <Breadcrumb className="min-w-0 overflow-hidden">
      <BreadcrumbList className="w-full min-w-0 flex-nowrap overflow-hidden whitespace-nowrap">
        {crumbs.map((crumb, i) => {
          const { href, label, isLast } = crumb;
          const shown = visibility(i);
          return (
            // Separator must be a SIBLING of BreadcrumbItem, not a
            // child — both render `<li>`, and `<li>` inside `<li>` is
            // invalid DOM。
            <Fragment key={href}>
              <BreadcrumbItem
                className={
                  isLast
                    ? 'min-w-0 flex-1'
                    : i === parentIndex
                      ? 'min-w-0 max-w-[40%] shrink'
                      : cn('shrink-0', shown)
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
                ) : crumb.linkable ? (
                  // shadcn 这套 BreadcrumbLink 用 @base-ui/react 的
                  // useRender，不接受 Radix 的 asChild —— 走 render
                  // prop 把 <a> 替换成 next/link。父级是二级页唯一的返回
                  // 入口：带上页面交来的列表上下文，表单提交中锁住。
                  <BreadcrumbLink
                    className="inline-flex min-h-11 min-w-0 max-w-full items-center"
                    render={
                      i === parentIndex ? (
                        <PendingLink
                          href={resolveBreadcrumbParentHref(href, parentOverride.href)}
                          pending={parentOverride.pending}
                          prefetch={false}
                        />
                      ) : (
                        <Link href={href} prefetch={false} />
                      )
                    }
                  >
                    {/* The truncating element carries the full text (visual gate: hidden-clipping). */}
                    <span className="min-w-0 truncate" title={label}>{label}</span>
                  </BreadcrumbLink>
                ) : (
                  // Layout-only ancestor: not navigable AND not the
                  // current page. Plain <span>, no aria-current.
                  <span className="block truncate text-muted-foreground" title={label}>
                    {label}
                  </span>
                )}
              </BreadcrumbItem>
              {!isLast && (
                <BreadcrumbSeparator className={cn('shrink-0', shown && shown.replace('inline-flex', 'block'))} />
              )}
            </Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
