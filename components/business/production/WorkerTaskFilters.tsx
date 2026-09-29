import { Disclosure, DisclosureSummary } from '@/components/ui/disclosure';
import Link from 'next/link';
import Form from 'next/form';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FilterClearLink, LinkPendingHint } from '@/components/ui-business';
import { cn } from '@/lib/utils';

// next/form 的 action 是路由路径，不是可见文案。
const WORKER_TASKS = { href: '/worker/tasks' } as const;
const WORKER_TASK_FILTER_FORM_ID = 'worker-task-filters';

export function WorkerTaskFilters({ query, view }: { query: string; view: string }) {
  return <div className="space-y-3">
    <nav aria-label="任务范围" className="flex flex-wrap gap-2 rounded-xl border bg-card p-2">
      {[['paid', '本岗位待做'], ['progress', '共享进度']].map(([value, label]) => <Link key={value} href={`/worker/tasks?${new URLSearchParams({ view: value, q: query })}`} scroll={false} aria-current={view === value ? 'page' : undefined} className={cn(buttonVariants({ variant: view === value ? 'selected' : 'ghost' }), 'relative min-h-11 px-3 font-medium')}>{label}<LinkPendingHint /></Link>)}
      <Link href="/worker/reports" className="inline-flex min-h-11 items-center rounded-md px-3 font-medium">我已报工</Link>
    </nav>
    {/* next/form 软导航不重建非受控字段：key 取已应用查询，提交 / 清除 / 后退时按 URL 重建。 */}
    <Form id={WORKER_TASK_FILTER_FORM_ID} key={JSON.stringify([view, query])} action={WORKER_TASKS.href} scroll={false} className="flex flex-wrap gap-2 rounded-xl border bg-card p-3">
      <input type="hidden" name="view" value={view} />
      <label className="min-w-0 flex-1"><span className="sr-only">搜索工单或款式</span><Input name="q" defaultValue={query} maxLength={100} placeholder="工单号、工单名或款式" className="min-h-11" /></label>
      <Button type="submit">搜索</Button>{query && <FilterClearLink href={`/worker/tasks?view=${view}`} formId={WORKER_TASK_FILTER_FORM_ID} className="inline-flex min-h-11 items-center underline" />}
    </Form>
    <Disclosure className="rounded-xl border bg-card p-3 text-sm"><DisclosureSummary className="cursor-pointer font-medium">如何扫码报工</DisclosureSummary><p className="mt-2">用微信扫一扫或手机相机扫描纸质工单上的二维码，登录本人账号后选择工序。无法扫码时，可搜索工单号进入报工。</p></Disclosure>
  </div>;
}
