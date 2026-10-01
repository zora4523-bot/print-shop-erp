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
  ActionNotice,
  ActionShortcut,
  BatchActionResult,
  ConflictResolutionPanel,
  ConfirmActionController, ConfirmActionDialog,
  ContentSkeleton,
  DisabledReason,
  EmptyState,
  EnvNotice,
  ErrorBoundary,
  ErrorState,
  FormErrorSummary,
  FormMessage,
  HeroBanner,
  LongTaskReceipt,
  NavCard,
  PageHeader,
  PendingButton,
  PendingLink,
  ReceiptNotice,
  SectionLoading,
  StatCard,
  StatusBadge,
  TableEmptyState,
  TableScrollArea,
  TerminalReadOnlyBanner,
  TONES,
  formMessageA11yProps,
} from '@/components/ui-business';
import { Button, buttonVariants } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { ORDER_STATUS_REGISTRY } from '@/lib/ui/status-registry';

// /dev/showcase —— 业务原子组件的可视化目录。
// **仅 dev 可见**：production 走 notFound() 不暴露。
// 用法：本地 `pnpm dev` → 访问 `/dev/showcase` 看完整设计系统。
// 改 globals.css 的语义 token 后这一页会立即反映视觉变化，省去逐页核验。

function CheckboxShowcase() {
  return (
    <Section
      title="Checkbox"
      subtitle="44px 触控区域与 20px 可视勾选框分离，覆盖默认、选中、混合和禁用状态。"
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label
          htmlFor="showcase-checkbox-default"
          className="flex min-h-14 cursor-pointer items-center justify-between gap-3 rounded-xl border bg-card py-1 pr-1 pl-3 text-sm font-medium"
        >
          默认
          <Checkbox id="showcase-checkbox-default" />
        </label>
        <label
          htmlFor="showcase-checkbox-checked"
          className="flex min-h-14 cursor-pointer items-center justify-between gap-3 rounded-xl border bg-card py-1 pr-1 pl-3 text-sm font-medium"
        >
          已选
          <Checkbox id="showcase-checkbox-checked" defaultChecked />
        </label>
        <label
          htmlFor="showcase-checkbox-mixed"
          className="flex min-h-14 cursor-not-allowed items-center justify-between gap-3 rounded-xl border bg-muted/40 py-1 pr-1 pl-3 text-sm font-medium text-muted-foreground"
        >
          部分选择（禁用示例）
          <Checkbox id="showcase-checkbox-mixed" indeterminate disabled />
        </label>
        <label
          htmlFor="showcase-checkbox-disabled"
          className="flex min-h-14 cursor-not-allowed items-center justify-between gap-3 rounded-xl border bg-muted/40 py-1 pr-1 pl-3 text-sm font-medium text-muted-foreground"
        >
          已禁用
          <Checkbox id="showcase-checkbox-disabled" disabled />
        </label>
      </div>
    </Section>
  );
}

export default function ShowcasePage() {
  if (process.env.NODE_ENV === 'production') notFound();

  return (
    <main className="mx-auto max-w-6xl space-y-12 p-8">
      <PageHeader
        title="设计系统 · Showcase"
        subtitle="业务原子组件 + tone 变体可视化目录。改 globals.css 的语义 token 后此页立即跟随。"
      />

      <Section title="HeroBanner">
        <HeroBanner
          title="欢迎回来，管理员"
          subtitle="今日 23 单提交、12 单待排产、5 单已完工待发货。"
          cta={
            <a
              href="/owner"
              className="text-sm font-medium text-primary underline-offset-2 hover:underline"
            >
              进入管理员看板 →
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
        subtitle="工单状态徽章——ORDER_STATUS_REGISTRY 渲染全 8 状态。"
      >
        <div className="flex flex-wrap items-center gap-2">
          {Object.entries(ORDER_STATUS_REGISTRY).map(([status, b]) => (
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
            description="管理产品资料、规格与纸张"
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

      <Section
        title="五态组件库"
        subtitle="ContentSkeleton / EmptyState kind / ErrorState / DisabledReason / PendingButton / LongTaskReceipt。"
      >
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <ContentSkeleton rows={4} variant="table" />
          <EmptyState kind="no-data" noun="工单" />
          <EmptyState kind="no-result" noun="工单" />
          <EmptyState kind="no-access" />
          <ErrorState title="这块数据没加载出来" description="分区级错误，其他分区照常显示。" />
          <ErrorState
            blocking
            title="有 2 个生产任务未完工，完工后可发货"
          />
          <DisabledReason cause="status" reason="已结案的工单不能修改">
            <button
              type="button"
              disabled
              className="rounded-lg border border-border bg-muted px-3 py-2 text-sm text-muted-foreground"
            >
              发货
            </button>
          </DisabledReason>
          <PendingButton pending groupNote="任意一行失败时，整组价格都不会保存">
            保存草稿
          </PendingButton>
          <LongTaskReceipt
            taskId="export-demo-001"
            title="已受理：正在生成导出文件"
            description="可以离开页面，完成后回这里下载"
            expiresAt="2026-08-24T18:00:00.000Z"
            now={new Date('2026-08-24T00:00:00.000Z')}
          />
          <EnvNotice>OSS 未配置 / mock-mode：这是环境提示，不是业务预警。</EnvNotice>
        </div>
      </Section>

      <Section
        title="ActionNotice"
        subtitle="操作反馈四种语义：success / info / warning 礼貌播报，error 强提醒。"
      >
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <ActionNotice
            tone="success"
            title="工单已保存"
            description="草稿编号 PO-20260824-018，可继续编辑。"
          />
          <ActionNotice
            tone="info"
            title="导出任务已进入队列"
            description="完成后会在通知中心提供下载链接。"
          />
          <ActionNotice
            tone="warning"
            title="还有 2 项资料待补充"
            description="可以保存草稿，但暂时不能提交生产。"
          />
          <ActionNotice
            tone="error"
            title="保存失败"
            description="网络连接已中断，请确认连接后重试。"
            action={
              <Button type="button" variant="outline" size="sm">
                重试
              </Button>
            }
          />
        </div>
      </Section>

      <Section
        title="表单反馈"
        subtitle="FormMessage 通过稳定 id 关联控件；FormErrorSummary 汇总并跳转到错误字段。"
      >
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="space-y-2 rounded-xl border bg-card p-4">
            <label htmlFor="showcase-unit-price" className="text-sm font-medium">
              单价
            </label>
            <Input
              id="showcase-unit-price"
              defaultValue="-20"
              {...formMessageA11yProps('showcase-unit-price', 'error')}
            />
            <FormMessage fieldId="showcase-unit-price" tone="error">
              单价必须大于或等于 0
            </FormMessage>
          </div>
          <FormErrorSummary
            errors={[
              {
                fieldId: 'showcase-unit-price',
                label: '单价',
                message: '必须大于或等于 0',
              },
              {
                fieldId: 'showcase-customer',
                label: '客户',
                message: '请选择有效客户',
              },
            ]}
          />
        </div>
      </Section>
      <CheckboxShowcase />
      <Section
        title="BatchActionResult"
        subtitle="批量动作的完整 / 部分 / 失败回执；失败项必须展示具体原因。"
      >
        <BatchActionResult
          status="partial"
          succeededCount={2}
          failedCount={1}
          items={[
            { id: 'PO-001', label: 'PO-001', outcome: 'success' },
            { id: 'PO-002', label: 'PO-002', outcome: 'success' },
            {
              id: 'PO-003',
              label: 'PO-003',
              outcome: 'failure',
              reason: '该工单已结案，不能再次排产。',
            },
          ]}
          action={
            <Button type="button" variant="outline" size="sm">
              仅重试失败项
            </Button>
          }
        />
      </Section>

      <Section
        title="ConflictResolutionPanel"
        subtitle="并发冲突不会静默覆盖；并列展示我的版本与最新版本，并保留取消路径。"
      >
        <ConflictResolutionPanel
          mine={
            <div className="space-y-1">
              <div>数量：1,200</div>
              <div>交期：8 月 28 日</div>
            </div>
          }
          latest={
            <div className="space-y-1">
              <div>数量：1,500</div>
              <div>交期：8 月 30 日</div>
            </div>
          }
          keepMineAction={
            <Button type="button" variant="outline" size="sm">
              保留我的版本
            </Button>
          }
          useLatestAction={
            <Button type="button" size="sm">
              使用最新版本
            </Button>
          }
          cancelAction={
            <Button type="button" variant="ghost" size="sm">
              取消
            </Button>
          }
        />
      </Section>

      <Section
        title="ConfirmActionDialog"
        subtitle="L2 先核对影响范围；L3 还必须填写审计理由，关闭后焦点回到触发按钮。"
      >
        <div className="flex flex-wrap gap-3">
          <ConfirmActionController level="L2"
            trigger={<Button variant="outline">停用通知群</Button>}>
            <ConfirmActionDialog action="停用“生产通知群”？" changes={[]} consequences={[
              '新通知不会再投递到该群。',
              '历史投递日志仍会保留。',
            ]} confirmText="确认停用" />
          </ConfirmActionController>
          <ConfirmActionController level="L3"
            trigger={<Button variant="destructive">作废结算结果</Button>}>
            <ConfirmActionDialog action="作废这份结算结果？" changes={[]} consequences={[
              '当前结算结果将不再作为付款依据。',
              '需要重新核算后才能继续后续流程。',
            ]} confirmText="填写理由并作废" />
          </ConfirmActionController>
        </div>
      </Section>

      <Section
        title="终态与表格空态"
        subtitle="终态保持中性只读；表格空态提供合法 table 行与紧凑移动形态。"
      >
        <div className="space-y-4">
          <TerminalReadOnlyBanner
            title="工单已结案，仅供查看"
            description="数量、价格和生产记录已锁定；后续调整请创建新工单。"
          />
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="overflow-hidden rounded-xl border">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-left">
                  <tr>
                    <th className="px-4 py-2 font-medium">工单号</th>
                    <th className="px-4 py-2 font-medium">状态</th>
                  </tr>
                </thead>
                <tbody>
                  <TableEmptyState
                    colSpan={2}
                    title="暂无待处理工单"
                    description="新工单提交后会出现在这里。"
                  />
                </tbody>
              </table>
            </div>
            <TableEmptyState
              variant="compact"
              title="筛选无结果"
              description="请清除筛选或更换查询条件。"
              action={
                <Button type="button" variant="outline" size="sm">
                  清除筛选
                </Button>
              }
            />
          </div>
        </div>
      </Section>

      <ShowcaseShellSections />
    </main>
  );
}

/** 页面外壳与导航反馈示例（PageHeader 槽位、回执、加载、导航忙碌、横滚表格、错误边界）。 */
function ShowcaseShellSections() {
  return (
    <>
        <Section
          title="PageHeader"
          subtitle="本页顶部就在用。二级页用返回槽（唯一返回入口）、单据状态进状态槽、作用域胶囊进眉标槽；师傅端用紧凑尺寸。"
        >
          <div className="space-y-4">
            <div className="rounded-xl border bg-card p-6">
              <PageHeader
                title="工单列表"
                subtitle="按角色范围显示 / 支持日期 / 客户 / 状态多维过滤。"
                actions={
                  <a href="#" className={buttonVariants()}>
                    新建工单
                  </a>
                }
              />
            </div>
            <div className="rounded-xl border bg-card p-6">
              <PageHeader
                back={{ href: '/dev/showcase', label: '返回工单列表' }}
                eyebrow={
                  <>
                    <StatusBadge tone="info">全厂适用</StatusBadge>
                    <StatusBadge tone="neutral">立即生效</StatusBadge>
                  </>
                }
                title="WO-20260929-001"
                subtitle="客户：示例客户 · 交期 2026-10-08"
                status={<StatusBadge tone="warning">待排产</StatusBadge>}
                actions={
                  <a href="#" className={buttonVariants({ variant: 'outline' })}>
                    编辑工单
                  </a>
                }
              />
            </div>
            <div className="max-w-sm rounded-xl border bg-card p-4">
              <PageHeader
                size="worker"
                back={{ href: '/dev/showcase', label: '返回我的任务' }}
                title="报工"
                subtitle="师傅端 H5 统一 20px 标题。"
              />
            </div>
          </div>
        </Section>

        <Section
          title="ReceiptNotice"
          subtitle="保存后跳转到新页面时，读取地址栏回执并播报保存结果。"
        >
          <ReceiptNotice receipt={{ created: '1' }} noun="工单" />
        </Section>

        <Section
          title="SectionLoading"
          subtitle="区块级 Suspense fallback：带可读 label 的加载占位。"
        >
          <SectionLoading label="最近下载包" />
        </Section>

        <Section
          title="PendingLink"
          subtitle="导航中的链接显示忙碌态，忙碌状态由调用方提供。"
        >
          <div className="flex flex-wrap gap-3">
            <PendingLink href="/dev/showcase" pending={false} className={buttonVariants({ variant: 'outline' })}>
              空闲
            </PendingLink>
            <PendingLink href="/dev/showcase" pending className={buttonVariants({ variant: 'outline' })}>
              跳转中
            </PendingLink>
          </div>
        </Section>

        <Section
          title="TableScrollArea"
          subtitle="窄屏横向滚动的表格容器，label 作为可访问名称。"
        >
          <TableScrollArea label="示例宽表" className="rounded-xl border bg-card">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  {['工单号', '客户', '款式', '数量', '交期', '状态'].map((h) => (
                    <th key={h} className="px-4 py-2 text-left">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="px-4 py-2 font-sans tabular-nums">WO-001</td>
                  <td className="px-4 py-2">示例客户</td>
                  <td className="px-4 py-2">烫金红包</td>
                  <td className="px-4 py-2 font-sans tabular-nums">5,000</td>
                  <td className="px-4 py-2 font-sans tabular-nums">2026-10-08</td>
                  <td className="px-4 py-2"><StatusBadge tone="info">生产中</StatusBadge></td>
                </tr>
              </tbody>
            </table>
          </TableScrollArea>
        </Section>

        <Section
          title="ErrorBoundary"
          subtitle="区块级错误边界：子树渲染失败时只替换本区块为 ErrorState（scope=section）并提供重试；正常时透明渲染子内容。"
        >
          <ErrorBoundary
            scope="section"
            title="最近下载包暂时无法加载"
            description="请重试加载该区块，其它区域不受影响。"
          >
            <div className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">
              子内容正常渲染时，边界不可见。
            </div>
          </ErrorBoundary>
        </Section>
    </>
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
