'use client';

import Link from 'next/link';
import { formatUnitPrice } from '@/lib/format/unit-price';
import { useActionState, useState, useEffect, useRef } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { ActionNotice, FormErrorSummary, PendingButton, StatusBadge } from '@/components/ui-business';
import type { PaperSpecificationsMutationResult } from '@/actions/paper-specifications.types';
import type { PaperSpecificationView } from '@/lib/price/paper-specification-view';
import { externalPriceBusinessText } from '@/lib/price/external-price-display';

const labels = { enabled: '已启用', inactive: '已停用', unconfigured: '待设置', 'needs-attention': '待处理', retired: '已退役' };
export function PaperSpecificationsForm({ view, action }: {
  view: PaperSpecificationView;
  action: (prev: PaperSpecificationsMutationResult | null, data: FormData) => Promise<PaperSpecificationsMutationResult>;
}) {
  const [result, formAction, pending] = useActionState(action, null);
  const [selected, setSelected] = useState<string[]>([]);
  const [reviewing, setReviewing] = useState(false);
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (reviewing) reviewHeading.current?.focus(); }, [reviewing]);
  const changes = view.cells.filter((cell) => selected.includes(cell.key));
  const errors = !pending && result?.status === 'invalid' ? Object.values(result.fieldErrors).flat().map((message) => ({ fieldId: 'paper-specifications', label: '适用规格', message })) : [];
  return <section className="space-y-4 rounded-xl border bg-card p-4 sm:p-6" aria-labelledby="paper-specifications-heading">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 id="paper-specifications-heading" className="text-base font-semibold">空白封适用规格</h2>
      <Link href="/owner/rules/specifications" className="text-sm text-primary underline">查看规格目录</Link>
    </div>
    {view.blocked ? <ActionNotice tone="warning" title="暂不能启用规格" description={view.blocked} /> : null}
    <form action={formAction} aria-busy={pending} className="space-y-4">
      <FormErrorSummary errors={errors} />
      <fieldset id="paper-specifications" className="grid min-w-0 gap-3 sm:grid-cols-2" disabled={pending || reviewing}>
        <legend className="sr-only">选择新增启用规格</legend>
        {view.cells.map((cell) => <div key={cell.key} className="min-w-0 space-y-2 rounded-lg border p-3">
          <label className="flex min-h-11 items-center gap-3">
            <Checkbox checked={cell.state === 'enabled' || selected.includes(cell.key)}
              disabled={!cell.canEnable || pending || reviewing}
              onCheckedChange={(checked) => setSelected((values) => checked ? [...values, cell.key] : values.filter((key) => key !== cell.key))} />
            <span className="min-w-0 flex-1 text-sm font-medium">{cell.specification}</span>
            <StatusBadge tone={cell.state === 'enabled' ? 'success' : cell.state === 'needs-attention' ? 'warning' : 'neutral'}>{labels[cell.state]}</StatusBadge>
          </label>
          {cell.blockedReason ? <p className="text-sm text-muted-foreground">{cell.blockedReason}</p> : null}
          {cell.state === 'enabled' ? <div className="space-y-1 text-sm text-muted-foreground">
            <p>{cell.availability}</p>
            <p>{!view.priceReadable ? '现行价格暂无法读取' : cell.price === null ? '待核价' : `现行单价 ${formatUnitPrice(cell.price)}/个`}</p>
          </div> : null}
          {cell.state === 'needs-attention' ? <p className="text-sm text-muted-foreground">组合重复或资料不一致，请检查相关组合；部分问题需要修正资料。</p> : null}
          {cell.relatedProducts.length ? <ul className="space-y-1 text-sm">{cell.relatedProducts.map((product, index) => <li key={product.id}>
            <Link className="text-primary underline" href={`/owner/rules/stock-skus/${product.id}`}>查看相关组合 {index + 1}（{product.isActive ? '启用' : '停用'}）</Link>
          </li>)}</ul> : null}
        </div>)}
      </fieldset>
      {selected.map((key) => <input key={key} type="hidden" name="specifications" value={key} />)}
      {reviewing ? <section className="space-y-3 rounded-lg border p-4" aria-labelledby="enable-review-heading" tabIndex={-1}>
        <h3 ref={reviewHeading} tabIndex={-1} id="enable-review-heading" className="font-semibold">启用 {externalPriceBusinessText(view.paperName)} 的 {changes.length} 种规格</h3>
        <ul className="space-y-2 text-sm">{changes.map((cell) => <li key={cell.key}>
          {cell.label}：{labels[cell.state]} → 已启用；{!view.priceReadable ? '现行价格暂无法读取，请到空白封单价检查' : cell.price === null ? '无现行单价，建单后待核价' : `按现行单价 ${formatUnitPrice(cell.price)}/个计价`}
        </li>)}</ul>
        {changes.some((cell) => cell.state === 'inactive') ? <p className="text-sm">本次包含已停用组合，将恢复建单选用；此前可能由管理员刻意停用。</p> : null}
        {!view.logisticsConfigured ? <p className="text-sm">该克重的物流单重未确认，物流费用可能待定。</p> : null}
        <p className="text-sm">本次只启用空白封规格，专版选项保持现状。操作记录可在审计变更中查看。</p>
        <input type="hidden" name="reviewed" value="yes" />
        <div className="flex flex-wrap gap-3">
          <PendingButton pending={pending} pendingLabel="正在启用规格…">启用规格</PendingButton>
          <Button type="button" variant="outline" disabled={pending} onClick={() => setReviewing(false)}>返回修改</Button>
        </div>
      </section> : <Button type="button" disabled={!changes.length || pending} onClick={() => setReviewing(true)}>复核启用规格</Button>}
      {!pending && result?.status === 'error' ? <ActionNotice tone="error" title="规格启用失败" description={result.message} /> : null}
      <Link href="/owner/rules/customer-pricing?section=blank" className="block text-sm text-primary underline">维护空白封单价</Link>
    </form>
  </section>;
}
