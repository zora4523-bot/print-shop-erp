import { notFound } from 'next/navigation';
import {
  Bell,
  BookOpen,
  Boxes,
  ClipboardList,
  FileArchive,
  FileText,
  Inbox,
  PackageOpen,
  PlusCircle,
  TrendingUp,
  Users,
  Wallet,
} from 'lucide-react';
import {
  ActionShortcut,
  EmptyState,
  HeroBanner,
  NavCard,
  PageHeader,
  StatCard,
  StatusBadge,
  TONES,
  ORDER_STATUS_TO_BADGE,
} from '@/components/ui-business';

// /dev/showcase —— 业务原子组件的可视化目录。
// **仅 dev 可见**：production 走 notFound() 不暴露。
// 用法：本地 `pnpm dev` → 访问 `/dev/showcase` 看完整设计系统。
// 改 globals.css 的语义 token 后这一页会立即反映视觉变化，省去逐页核验。

export default function ShowcasePage() {
  if (process.env.NODE_ENV === 'production') notFound();

  return (
    <div className="mx-auto max-w-6xl space-y-12 p-8">
      <PageHeader
        title="设计系统 · Showcase"
        subtitle="业务原子组件 + tone 变体可视化目录。改 globals.css 的语义 token 后此页立即跟随。"
      />

      <Section title="HeroBanner">
        <HeroBanner
          title="欢迎回来，老板"
          subtitle="今日 23 单提交、12 单待排产、5 单已完工待发货。"
          cta={
            <a
              href="/owner"
              className="text-sm font-medium text-primary underline-offset-2 hover:underline"
            >
              进入老板看板 →
            </a>
          }
        />
      </Section>

      <Section
        title="StatCard"
        subtitle="4 个 KPI tone（primary / warning / info / success），含同比 delta。"
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="今日工单"
            value="23 单"
            icon={ClipboardList}
            tone="primary"
            delta={{ direction: 'up', label: '15%', goodDirection: 'up' }}
          />
          <StatCard
            label="待处理工单"
            value="12 单"
            icon={Inbox}
            tone="warning"
            delta={{ direction: 'down', label: '8%', goodDirection: 'down' }}
          />
          <StatCard
            label="本月销售额"
            value="¥186,560"
            icon={TrendingUp}
            tone="info"
            delta={{ direction: 'up', label: '12.6%', goodDirection: 'up' }}
          />
          <StatCard
            label="待收款金额"
            value="¥68,920"
            icon={Wallet}
            tone="success"
            delta={{ direction: 'down', label: '6.3%', goodDirection: 'down' }}
          />
        </div>
      </Section>

      <Section
        title="StatusBadge"
        subtitle="工单状态徽章——ORDER_STATUS_TO_BADGE map 渲染全 8 状态。"
      >
        <div className="flex flex-wrap items-center gap-2">
          {Object.entries(ORDER_STATUS_TO_BADGE).map(([status, b]) => (
            <StatusBadge key={status} tone={b.tone} dot={b.dot}>
              {b.label}
            </StatusBadge>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {TONES.map((t) => (
            <StatusBadge key={t} tone={t} dot>
              {t}
            </StatusBadge>
          ))}
        </div>
      </Section>

      <Section title="ActionShortcut" subtitle="grid 排布的快捷操作卡。">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <ActionShortcut
            href="#"
            icon={PlusCircle}
            label="新建工单"
            description="创建生产工单"
            tone="primary"
          />
          <ActionShortcut
            href="#"
            icon={BookOpen}
            label="添加工艺"
            description="新增工艺流程"
            tone="warning"
          />
          <ActionShortcut
            href="#"
            icon={PackageOpen}
            label="新建产品"
            description="录入产品信息"
            tone="info"
          />
          <ActionShortcut
            href="#"
            icon={Wallet}
            label="创建账单"
            description="生成销售账单"
            tone="success"
          />
        </div>
      </Section>

      <Section title="NavCard" subtitle="列表排布的导航卡，含右侧 chevron。">
        <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
          <NavCard
            href="#"
            icon={Users}
            label="账号管理"
            description="新增 / 编辑 / 停用员工账号"
            tone="primary"
          />
          <NavCard
            href="#"
            icon={BookOpen}
            label="工艺字典"
            description="管理工艺清单、默认机器、外协标记"
            tone="warning"
          />
          <NavCard
            href="#"
            icon={Boxes}
            label="产品库"
            description="管理产品清单、规格、建议单价"
            tone="info"
          />
          <NavCard
            href="#"
            icon={Wallet}
            label="销售应收账单"
            description="月账单生成、发单、录入付款"
            tone="success"
            trailing={<span>3 条待发</span>}
          />
          <NavCard
            href="#"
            icon={Bell}
            label="推送配置"
            description="企业微信群组 / 事件订阅"
            tone="neutral"
          />
          <NavCard
            href="#"
            icon={FileArchive}
            label="CDR 汇总"
            description="设计图打包给外协"
            tone="primary"
          />
        </div>
      </Section>

      <Section title="EmptyState" subtitle="表无数据 / 搜索无命中。">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <EmptyState
            icon={Inbox}
            title="暂无待处理工单"
            description="师傅已完成今日全部任务，新工单提交后会出现在这里。"
          />
          <EmptyState
            icon={FileText}
            title="筛选无结果"
            description="试试清除日期范围或更改状态过滤条件。"
            action={
              <a
                href="#"
                className="text-xs font-medium text-primary underline-offset-2 hover:underline"
              >
                清除筛选 →
              </a>
            }
          />
        </div>
      </Section>

      <Section title="PageHeader" subtitle="本页顶部就在用。">
        <div className="rounded-xl border bg-card p-6">
          <PageHeader
            title="工单列表"
            subtitle="按角色范围显示 / 支持日期 / 客户 / 状态多维过滤。"
            actions={
              <a
                href="#"
                className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
              >
                新建工单
              </a>
            }
          />
        </div>
      </Section>
    </div>
  );
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-base font-semibold tracking-tight">{title}</h2>
        {subtitle ? (
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}
