import { requirePermission } from '@/lib/auth/permissions';
import { PageHeader } from '@/components/ui-business';
import { buttonVariants } from '@/components/ui/button';

export const metadata = { title: '历史财务看板' };

export default async function HistoricalFinancePage() {
  await requirePermission('report:all');
  return <div className="min-w-0 space-y-6">
    <PageHeader title="历史财务看板" />
    <p className="text-sm text-muted-foreground">查看历史订单收入、分类支出、报销、纸张成本及大表哥专项核算。原始记录与待核金额在看板中分别展示。</p>
    <p className="text-sm text-muted-foreground">数据来自历史订单文件，整理版本为 2026 年 9 月 29 日。ERP 新增工单请在经营概览中查看。</p>
    {/* Static HTML needs a full document navigation rather than an RSC request. */}
    <a href="/historical-finance/index.html" target="_blank" rel="noopener noreferrer" aria-label="打开历史财务看板（新窗口）" className={buttonVariants({ className: 'min-h-11' })}>打开看板 ↗</a>
  </div>;
}
