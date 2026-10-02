import { AdminPagination } from '@/components/business/admin/AdminDataTable';
import { ActionNotice } from '@/components/ui-business';
import { presentCdrHistory } from '@/lib/cdr/history';
import Form from 'next/form';
import Link from 'next/link';
import { requirePermission } from '@/lib/auth/permissions';
import { listWorkbenchOrders } from '@/lib/cdr/workbench';
import { listRecentBundles } from '@/lib/cdr/bundle';
import { cdrWorkbenchFilterSchema, CDR_WORKBENCH_PAGE_SIZE } from '@/lib/cdr/workbench-model';
import { isMockMode } from '@/lib/cdr/zip';
import { Card, CardHeader, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { CdrWorkbench } from './CdrWorkbench';

export async function CdrWorkbenchSection({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePermission('design:bundle:create');
  const query = await searchParams;
  const parsed = cdrWorkbenchFilterSchema.safeParse({ scope: query.cdrScope, from: query.cdrFrom, to: query.cdrTo, q: query.cdrQ, page: query.cdrPage });
  const filter = parsed.success ? parsed.data : cdrWorkbenchFilterSchema.parse({});
  const [{ orders, total, page }, history] = await Promise.all([listWorkbenchOrders(filter), listRecentBundles(20)]);
  return <Card id="cdr-download" className="min-w-0">
    <CardHeader><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-semibold">CDR 下载</h2><Button nativeButton={false} render={<Link href="/foreman/cdr" />} variant="ghost">按日期汇总</Button></div></CardHeader>
    <CardContent className="min-w-0 space-y-4">
      <Form action="/owner#cdr-download" key={JSON.stringify(filter)} className="flex flex-wrap items-end gap-3">
        <label className="min-w-0 space-y-1 text-xs text-muted-foreground">工单范围<NativeSelect name="cdrScope" defaultValue={filter.scope} className="block"><option value="pending">待生产</option><option value="all">全部已提交工单</option></NativeSelect></label>
        <label className="min-w-0 space-y-1 text-xs text-muted-foreground">提交起日<Input name="cdrFrom" type="date" defaultValue={filter.from} className="block w-auto max-w-full" /></label>
        <label className="min-w-0 space-y-1 text-xs text-muted-foreground">提交止日<Input name="cdrTo" type="date" defaultValue={filter.to} className="block w-auto max-w-full" /></label>
        <label className="min-w-0 flex-1 basis-48 space-y-1 text-xs text-muted-foreground">搜索工单或外部销售<Input name="cdrQ" maxLength={100} defaultValue={filter.q} placeholder="工单号 / 名称 / 销售账号" /></label>
        <Button type="submit" variant="outline">筛选</Button><Button nativeButton={false} render={<Link href="/owner#cdr-download" />} variant="ghost">重置</Button>
      </Form>
      {!parsed.success && <ActionNotice tone="error" title="筛选条件无效，已显示默认范围" />}
      <p className="text-xs text-muted-foreground">{filter.scope === 'pending' ? '待生产含待下发、已下发及历史排产工单，不含寄样；缺少 CDR 的工单列在待处理中。不限日期时包含往日工单。' : '全部范围含暂停、取消和已完成工单，请核对状态。'} 共 {total} 单，本页 {orders.length} 单。</p>
      <CdrWorkbench orders={orders} bundles={history.map((row) => presentCdrHistory(row))} mock={isMockMode()} now={new Date().toISOString()} />
      {total > CDR_WORKBENCH_PAGE_SIZE && <AdminPagination basePath="/owner" anchor="cdr-download" page={page}
        pageCount={Math.ceil(total / CDR_WORKBENCH_PAGE_SIZE)} total={total} pageSize={CDR_WORKBENCH_PAGE_SIZE}
        pageParam="cdrPage" queryParams={{ cdrScope: filter.scope, cdrFrom: filter.from, cdrTo: filter.to, cdrQ: filter.q }} />}
    </CardContent>
  </Card>;
}
