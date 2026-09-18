import { Disclosure, DisclosureSummary } from '@/components/ui/disclosure';
import Link from 'next/link';
import { Button } from '@/components/ui/button';

export function WorkerTaskFilters({ query, view }: { query: string; view: string }) {
  return <div className="space-y-3">
    <nav aria-label="任务范围" className="flex flex-wrap gap-2 rounded-xl border bg-card p-2">
      {[['paid', '本岗位待做'], ['progress', '共享进度']].map(([value, label]) => <Link key={value} href={`/worker/tasks?${new URLSearchParams({ view: value, q: query })}`} aria-current={view === value ? 'page' : undefined} className={`inline-flex min-h-11 items-center rounded-lg px-3 font-medium ${view === value ? 'bg-primary text-primary-foreground' : ''}`}>{label}</Link>)}
      <Link href="/worker/reports" className="inline-flex min-h-11 items-center rounded-lg px-3 font-medium">我已报工</Link>
    </nav>
    <form className="flex flex-wrap gap-2 rounded-xl border bg-card p-3">
      <input type="hidden" name="view" value={view} />
      <label className="min-w-0 flex-1"><span className="sr-only">搜索工单或款式</span><input name="q" defaultValue={query} maxLength={100} placeholder="工单号、工单名或款式" className="w-full rounded-md border bg-background px-3 py-2" /></label>
      <Button type="submit">搜索</Button>{query && <Link href={`/worker/tasks?view=${view}`} className="inline-flex min-h-11 items-center underline">清除</Link>}
    </form>
    <Disclosure className="rounded-xl border bg-card p-3 text-sm"><DisclosureSummary className="cursor-pointer font-medium">如何扫码报工</DisclosureSummary><p className="mt-2">用微信扫一扫或手机相机扫描纸质工单上的二维码，登录本人账号后选择工序。无法扫码时，可搜索工单号进入报工。</p></Disclosure>
  </div>;
}
