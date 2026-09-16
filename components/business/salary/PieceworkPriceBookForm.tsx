'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import Decimal from 'decimal.js';
import { formatUnitPrice } from '@/lib/format/unit-price';
import { mutatePieceworkRulesAction } from '@/actions/owner-piecework-rules';
import type { PieceworkActionResult } from '@/actions/owner-piecework-rules.types';
import type { PieceworkAdminBook } from '@/lib/salary/piecework-admin';
import { PIECEWORK_RATE_FIELDS } from '@/lib/salary/piecework-admin-input';
import { formatDateTimeLocalShanghai, formatDateTimeShanghai } from '@/lib/format/dates';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/native-select';
import { Input } from '@/components/ui/input';
import { FormMessage } from '@/components/ui-business';
import { Disclosure, DisclosureSummary } from '@/components/ui/disclosure';
import { Badge } from '@/components/ui/badge';

function rateFor(book: PieceworkAdminBook | undefined, field: typeof PIECEWORK_RATE_FIELDS[number]) {
  return book?.rules.find((r) => r.operationType === field.operationType && r.unit === field.unit)?.amount ?? '';
}
function stateLabel(book: PieceworkAdminBook, now: string) {
  if (book.status === 'DRAFT') return '草稿';
  if (book.effectiveFrom > now) return '待生效';
  if (book.effectiveTo && book.effectiveTo <= now) return '历史版本';
  return '当前生效';
}
export function PieceworkPriceBookForm({ books, now }: { books: PieceworkAdminBook[]; now: string }) {
  const draft = books.find((book) => book.status === 'DRAFT');
  const [state, action, pending] = useActionState<PieceworkActionResult | null, FormData>(mutatePieceworkRulesAction, null);
  return <section className="space-y-5 rounded-xl border bg-card p-5 shadow-sm" aria-labelledby="piecework-heading">
    <h2 id="piecework-heading" className="font-semibold">计件工价</h2>
    <div className="space-y-1 text-sm text-muted-foreground">
      <p>局部烫金工资 = 合格完成数 × 计薪过版次数 × 每下工价</p>
      <p>专版烫金工资 = 合格完成数 × 每个工价</p>
      <Link href="/orders" className="inline-flex min-h-11 items-center underline underline-offset-4">到工单详情调整计薪过版次数</Link>
    </div>
    {state && <div role={state.status === 'error' ? 'alert' : undefined}><FormMessage fieldId="piecework-result" tone={state.status}>{state.message}</FormMessage></div>}
    {!draft && <form aria-busy={pending} action={action}><Button type="submit" name="intent" value="create" disabled={pending}>{pending ? '创建中…' : '新建调价草稿'}</Button></form>}
    {draft && <DraftEditor key={`${draft.version}:${draft.updatedAt}`} draft={draft} previous={books.find((b) => b.version === draft.version - 1)} action={action} pending={pending} fieldErrors={state?.fieldErrors} />}
    <div className="space-y-3">
      {books.filter((b) => b.status === 'PUBLISHED').map((book) => <Disclosure key={book.version} className="rounded-lg border p-3" open={stateLabel(book, now) === '当前生效'}>
        <DisclosureSummary className="flex-wrap gap-2">第 {book.version} 版 <Badge variant="outline">{stateLabel(book, now)}</Badge> · {formatDateTimeShanghai(new Date(book.effectiveFrom))}</DisclosureSummary>
        <dl className="mt-3 grid gap-3 sm:grid-cols-2">
          {PIECEWORK_RATE_FIELDS.map((field) => <div key={field.key}><dt className="text-sm text-muted-foreground">{field.label}</dt><dd>{rateFor(book, field) || '未配置'} {rateFor(book, field) && field.unitLabel}</dd></div>)}
        </dl>
        <p className="mt-3 break-words text-sm">调价依据：{book.sourceName}</p>
        <p className="break-words text-sm">调整说明：{book.publishNote}</p>
      </Disclosure>)}
    </div>
  </section>;
}
function DraftEditor({ draft, previous, action, pending, fieldErrors }: {
  draft: PieceworkAdminBook; previous?: PieceworkAdminBook;
  action: (formData: FormData) => void; pending: boolean; fieldErrors?: Record<string, string[]>;
}) {
  const [dirty, setDirty] = useState(false);
  const [review, setReview] = useState(false);
  const [scheduled, setScheduled] = useState(Boolean(draft.effectiveFrom));
  const [effective, setEffective] = useState(draft.effectiveFrom ? formatDateTimeLocalShanghai(new Date(draft.effectiveFrom)) : '');
  const validTime = effective && Number.isFinite(new Date(`${effective}+08:00`).getTime());
  const ready = Boolean(draft.sourceName && draft.publishNote.length >= 2 && PIECEWORK_RATE_FIELDS.slice(0, 3).every((field) => rateFor(draft, field)));
  return <div className="space-y-4">
    <p className="text-sm font-medium">第 {draft.version} 版 · 草稿</p>
    <form aria-busy={pending} action={action} onChange={() => { setDirty(true); setReview(false); }} className="space-y-4">
      <input type="hidden" name="version" value={draft.version} />
      <input type="hidden" name="updatedAt" value={draft.updatedAt} />
      <input type="hidden" name="effectiveFrom" value={scheduled && validTime ? new Date(`${effective}+08:00`).toISOString() : ''} />
      <fieldset disabled={pending} className="grid min-w-0 gap-4 sm:grid-cols-2">
        {PIECEWORK_RATE_FIELDS.map((field) => <label key={field.key} className="space-y-1 text-sm" htmlFor={`piecework-${field.key}`}>
          <span>{field.label}（{field.unitLabel}）{field.key === 'box' ? ' · 选填' : ''}</span>
          <Input id={`piecework-${field.key}`} name={field.key} aria-invalid={Boolean(fieldErrors?.[field.key])} aria-describedby={fieldErrors?.[field.key] ? `piecework-${field.key}-message` : undefined} inputMode="decimal" defaultValue={rateFor(draft, field)} placeholder="待录" maxLength={15} pattern="[0-9]{1,10}(\.[0-9]{1,4})?" />
          {fieldErrors?.[field.key]?.map((message) => <FormMessage key={message} fieldId={`piecework-${field.key}`} tone="error">{message}</FormMessage>)}
        </label>)}
        <label className="space-y-1 text-sm" htmlFor="piecework-source"><span>调价依据</span><Input id="piecework-source" name="sourceName" maxLength={500} defaultValue={draft.sourceName} /></label>
        <label className="space-y-1 text-sm" htmlFor="piecework-note"><span>调整说明（发布时至少两字）</span><Input id="piecework-note" name="publishNote" maxLength={500} defaultValue={draft.publishNote} /></label>
        <label className="space-y-1 text-sm" htmlFor="piecework-mode"><span>生效方式</span><NativeSelect id="piecework-mode" value={scheduled ? 'scheduled' : 'immediate'} onChange={(e) => setScheduled(e.target.value === 'scheduled')}><option value="immediate">立即生效</option><option value="scheduled">指定时间</option></NativeSelect></label>
        {scheduled && <label className="space-y-1 text-sm" htmlFor="piecework-effective"><span>生效时间（北京时间）</span><Input id="piecework-effective" type="datetime-local" required value={effective} onChange={(e) => setEffective(e.target.value)} /></label>}
      </fieldset>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" name="intent" value="save" disabled={pending || (scheduled && !validTime)}>{pending ? '处理中…' : '保存草稿'}</Button>
        <Button type="button" variant="outline" disabled={pending || dirty || !ready} onClick={() => setReview(true)}>核对并发布</Button>
      </div>
      {dirty && <FormMessage fieldId="piecework-save">请先保存修改再发布。</FormMessage>}
    </form>
    {review && <form aria-busy={pending} action={action} className="space-y-4 rounded-lg border bg-muted/20 p-4" aria-label="发布工价">
      <h3 className="font-medium">发布第 {draft.version} 版工价</h3>
      <ul className="space-y-2 text-sm">
        {PIECEWORK_RATE_FIELDS.map((field) => {
          const old = rateFor(previous, field); const next = rateFor(draft, field);
          const difference = old && next ? new Decimal(next).minus(old) : null;
          return <li key={field.key}>{field.label}：{old || '未配置'} → {next || '未配置'} {next && field.unitLabel}{difference && `（差额 ${difference.gte(0) ? '+' : ''}${formatUnitPrice(difference)}）`}</li>;
        })}
      </ul>
      <p className="text-sm">生效时间：{draft.effectiveFrom ? formatDateTimeShanghai(new Date(draft.effectiveFrom)) : '发布后立即生效'}。生效后的报工使用新工价，已有工资保持不变。{!rateFor(draft, PIECEWORK_RATE_FIELDS[3]) && '未配置装盒工价，装盒报工将暂停。'}</p>
      <input type="hidden" name="version" value={draft.version} /><input type="hidden" name="updatedAt" value={draft.updatedAt} />
      <div className="flex gap-2"><Button name="intent" value="publish" type="submit" disabled={pending}>{pending ? '发布中…' : '发布工价'}</Button><Button type="button" variant="outline" disabled={pending} onClick={() => setReview(false)}>返回编辑</Button></div>
    </form>}
  </div>;
}
