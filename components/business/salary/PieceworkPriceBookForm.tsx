'use client';
import { DEFAULT_FOIL_WAGES, FOIL_WAGE_THRESHOLD } from '@/lib/salary/foil-wage';

import Link from 'next/link';
import { CancelPieceworkPlan } from './CancelPieceworkPlan';
import { useActionState, useEffect, useRef, useState } from 'react';
import Decimal from 'decimal.js';
import { formatUnitPrice } from '@/lib/format/unit-price';
import { mutatePersonalPieceworkAction } from '@/actions/owner-personal-piecework';
import { mutatePieceworkRulesAction } from '@/actions/owner-piecework-rules';
import type { PieceworkActionResult } from '@/actions/owner-piecework-rules.types';
import type { PieceworkAdminBook } from '@/lib/salary/piecework-admin';
import { PIECEWORK_RATE_FIELDS, FOIL_WAGE_FIELDS } from '@/lib/salary/piecework-admin-input';
import { formatDateTimeLocalShanghai, formatDateTimeShanghai } from '@/lib/format/dates';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/native-select';
import { Input } from '@/components/ui/input';
import { FormMessage } from '@/components/ui-business';
import { Disclosure, DisclosureIndicator, DisclosureSummary } from '@/components/ui/disclosure';
import { Badge } from '@/components/ui/badge';

function rateFor(book: PieceworkAdminBook | undefined, field: RateField) {
  const rule = book?.rules.find((r) => r.operationType === field.operationType && r.unit === field.unit);
  return rule?.['column' in field ? field.column : 'amount'] ?? '';
}
function stateLabel(book: PieceworkAdminBook, now: string) {
  if (book.status === 'CANCELLED') return '已取消';
  if (book.status === 'DRAFT') return '草稿';
  if (book.effectiveFrom > now) return '待生效';
  if (book.effectiveTo && book.effectiveTo <= now) return '历史版本';
  return '当前生效';
}
type RateField = typeof PIECEWORK_RATE_FIELDS[number] | typeof FOIL_WAGE_FIELDS[number];
const allFields: RateField[] = PIECEWORK_RATE_FIELDS.flatMap((field) => [field, ...FOIL_WAGE_FIELDS.filter((fee) => fee.operationType === field.operationType)] as RateField[]);
export function PieceworkPriceBookForm({ books, now, personal, cancellationEnabled = false }: { books: PieceworkAdminBook[]; now: string; cancellationEnabled?: boolean; personal?: { workerId: string; lane: string | null; canEdit: boolean; unifiedBooks: PieceworkAdminBook[] } }) {
  const fields = allFields.filter((f) => !personal || f.operationType === personal.lane);
  const canEdit = !personal || personal.canEdit;
  const mutate = personal ? mutatePersonalPieceworkAction.bind(null, personal.workerId) : mutatePieceworkRulesAction;
  const current = books.find((b) => stateLabel(b, now) === '当前生效');
  const unifiedAt = books.find((b) => b.status === 'DRAFT')?.effectiveFrom || now;
  const unifiedReference = personal?.unifiedBooks.find((b) => b.status === 'PUBLISHED' && b.effectiveFrom <= unifiedAt && (!b.effectiveTo || b.effectiveTo > unifiedAt));
  const draft = books.find((book) => book.status === 'DRAFT');
  const comparisonAt = draft?.effectiveFrom || now;
  const previous = books.find((book) => book.status === 'PUBLISHED' && book.effectiveFrom <= comparisonAt && (!book.effectiveTo || book.effectiveTo > comparisonAt));
  const template = books.find((book) => book.status === 'PUBLISHED');
  const [state, action, pending] = useActionState<PieceworkActionResult | null, FormData>(mutate, null);
  const [cancelled, setCancelled] = useState<{ id: string; message: string; previousResult: PieceworkActionResult | null } | null>(null);
  if (cancelled && state !== cancelled.previousResult) setCancelled(null);
  const summaries = useRef(new Map<string, HTMLElement>());
  useEffect(() => {
    if (cancelled && books.some((book) => book.id === cancelled.id && book.status === 'CANCELLED')) summaries.current.get(cancelled.id)?.focus();
  }, [books, cancelled]);
  return <section className="space-y-5 rounded-xl border bg-card p-5 shadow-sm" aria-labelledby="piecework-heading">
    <h2 id="piecework-heading" className="font-semibold">计件工价</h2>
    <div className="space-y-3 text-sm text-muted-foreground">
      {personal ? <p>当前模式：{current && !current.useUnifiedRates ? '个人工价' : '统一工价'}，适用于本账号的生产计件工资。</p> : <>
        <p>统一工价适用于使用统一工价的生产师傅。已启用个人工价的师傅，按账号中生效的个人工价计算。</p>
        <Link href="/owner/accounts" className="inline-flex min-h-11 items-center underline underline-offset-4">到师傅账号设置个人工价</Link>
      </>}
      {(!personal || personal.lane === 'PARTIAL' || personal.lane === 'FULL') && <div className="space-y-3">
        <p className="font-medium text-foreground">烫金数量与工资</p>
        <p>按同一生产任务的实际完成件数区分大小单；默认取该任务的计划件数，多款合并生产时合计这些款式的件数。</p>
        <dl className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1"><dt className="font-medium text-foreground">小单：1–{FOIL_WAGE_THRESHOLD} 个（含 {FOIL_WAGE_THRESHOLD} 个）</dt><dd>小单工资 × 次数，已含装版费。</dd></div>
          <div className="space-y-1"><dt className="font-medium text-foreground">大单：{FOIL_WAGE_THRESHOLD + 1} 个及以上</dt><dd>实际完成件数 × 计件单价 × 次数 ＋ 大单装版费 × 次数。</dd></div>
        </dl>
        <p>件数按红包个数计算；局部烫金的次数为过版次数，专版烫金的次数为不同颜色数，同色在正反两面只算一种颜色。</p>
        <Disclosure>
          <DisclosureSummary className="gap-2">分批报工的数量规则<DisclosureIndicator /></DisclosureSummary>
          <p className="mt-2">使用扫码分批报工的工单，按该工序关联款式的工单总件数判档。每批只计算本批工资，小单工资或大单装版费在同一工序只计一次；多人协作、改版或颜色数不同的合并生产，由管理员核定提成。</p>
        </Disclosure>
      </div>}
      {(!personal || personal.lane === 'PACKING') && <p>包装按实际完成袋数或盒数 × 对应工价计算，不区分大小单。</p>}
    </div>
    {state && !cancelled && <div role={state.status === 'error' ? 'alert' : undefined}><FormMessage fieldId="piecework-result" tone={state.status}>{state.message}</FormMessage></div>}
    {cancelled && <FormMessage fieldId="piecework-cancellation-result" tone="success">{cancelled.message}</FormMessage>}
    {!draft && canEdit && template && template.effectiveFrom > now && <p className="text-sm">新草稿将沿用待生效的第 {template.version} 版工价；其计划时间为 {formatDateTimeShanghai(new Date(template.effectiveFrom))}。</p>}
    {!draft && canEdit && <form aria-busy={pending} action={action}><Button type="submit" name="intent" value="create" disabled={pending}>{pending ? '正在创建…' : '新建调价草稿'}</Button></form>}
    {draft && canEdit && <DraftEditor unifiedReference={unifiedReference} personal={Boolean(personal)} fields={fields} key={`${draft.version}:${draft.updatedAt}`} draft={draft} previous={previous} action={action} pending={pending} fieldErrors={state?.fieldErrors} />}
    <div className="space-y-3">
      {books.filter((b) => b.status !== 'DRAFT').map((book) => <Disclosure key={book.version} className="rounded-lg border p-3" open={cancelled?.id === book.id || ['当前生效', '待生效'].includes(stateLabel(book, now))}>
        <DisclosureSummary ref={(node) => { if (node) summaries.current.set(book.id, node); else summaries.current.delete(book.id); }} className="flex-wrap gap-2">第 {book.version} 版 <Badge variant="outline">{stateLabel(book, now)}</Badge> · {formatDateTimeShanghai(new Date(book.effectiveFrom))}</DisclosureSummary>
        {personal && <p className="mt-3 text-sm">{book.useUnifiedRates ? '使用统一工价' : '使用个人工价'}</p>}
        <dl className="mt-3 grid gap-3 sm:grid-cols-2">
          {(book.useUnifiedRates ? [] : allFields.filter((f) => (!personal || book.rules.some((r) => r.unit === f.unit)) && (!('column' in f) || rateFor(book, f) !== ''))).map((field) => <div key={field.key}><dt className="text-sm text-muted-foreground">{field.label}</dt><dd>{rateFor(book, field) || '未配置'} {rateFor(book, field) && field.unitLabel}</dd></div>)}
        </dl>
        {!personal && <p className="mt-3 break-words text-sm">调价依据：{book.sourceName}</p>}
        <p className="break-words text-sm">调整说明：{book.publishNote}</p>
        {book.status === 'CANCELLED' && <p className="mt-3 break-words text-sm">取消原因：{book.cancelReason}{book.cancelledAt ? ` · ${formatDateTimeShanghai(new Date(book.cancelledAt))}` : ''}</p>}
        {book.status === 'CANCELLED' && draft && canEdit && <Link className="inline-flex min-h-11 items-center text-sm underline" href="#piecework-draft">继续编辑调价草稿</Link>}
        {cancellationEnabled && book.status === 'PUBLISHED' && book.effectiveFrom > now && <CancelPieceworkPlan workerId={personal?.workerId ?? null} targetId={book.id} hasDraft={Boolean(draft)} onSuccess={(message) => setCancelled({ id: book.id, message, previousResult: state })} />}
      </Disclosure>)}
    </div>
  </section>;
}
function DraftEditor({ draft, previous, action, pending, fieldErrors, fields, personal, unifiedReference }: {
  unifiedReference?: PieceworkAdminBook;
  fields: RateField[]; personal: boolean;
  draft: PieceworkAdminBook; previous?: PieceworkAdminBook;
  action: (formData: FormData) => void; pending: boolean; fieldErrors?: Record<string, string[]>;
}) {
  const [unified, setUnified] = useState(draft.useUnifiedRates);
  const [dirty, setDirty] = useState(false);
  const [review, setReview] = useState(false);
  const [scheduled, setScheduled] = useState(Boolean(draft.effectiveFrom));
  const [effective, setEffective] = useState(draft.effectiveFrom ? formatDateTimeLocalShanghai(new Date(draft.effectiveFrom)) : '');
  const validTime = effective && Number.isFinite(new Date(`${effective}+08:00`).getTime());
  const ready = Boolean((personal || draft.sourceName) && draft.publishNote.length >= 2 && (draft.useUnifiedRates || fields.filter((f) => f.key !== 'box' && (personal || f.key !== 'bag')).every((field) => rateFor(draft, field))));
  return <div id="piecework-draft" className="space-y-4">
    <p className="text-sm font-medium">第 {draft.version} 版 · 草稿</p>
    <form aria-busy={pending} action={action} onChange={() => { setDirty(true); setReview(false); }} className="space-y-4">
      <input type="hidden" name="version" value={draft.version} />
      <input type="hidden" name="updatedAt" value={draft.updatedAt} />
      <input type="hidden" name="effectiveFrom" value={scheduled && validTime ? new Date(`${effective}+08:00`).toISOString() : ''} />
      {personal && <div className="space-y-1 text-sm"><label htmlFor="piecework-personal-mode">工价模式</label><NativeSelect id="piecework-personal-mode" name="useUnifiedRates" value={unified ? 'true' : 'false'} onChange={(e) => setUnified(e.target.value === 'true')} disabled={pending}><option value="true">使用统一工价</option><option value="false">使用个人工价</option></NativeSelect></div>}
      <fieldset disabled={pending} className="grid min-w-0 gap-4 sm:grid-cols-2">
        {(personal && unified ? [] : fields).map((field) => <label key={field.key} className="space-y-1 text-sm" htmlFor={`piecework-${field.key}`}>
          <span>{field.label}（{field.unitLabel}）{(field.key === 'box' || (!personal && field.key === 'bag')) ? ' · 选填' : ''}</span>
          <Input id={`piecework-${field.key}`} name={field.key} aria-invalid={Boolean(fieldErrors?.[field.key])} aria-describedby={fieldErrors?.[field.key] ? `piecework-${field.key}-message` : undefined} inputMode="decimal" defaultValue={rateFor(draft, field) || ('defaultValue' in field ? field.defaultValue : field.key === 'partial' ? DEFAULT_FOIL_WAGES.PARTIAL.pieceRate : field.key === 'full' ? DEFAULT_FOIL_WAGES.FULL.pieceRate : '')} placeholder="待录" maxLength={15} pattern="[0-9]{1,10}(\.[0-9]{1,4})?" />
          {fieldErrors?.[field.key]?.map((message) => <FormMessage key={message} fieldId={`piecework-${field.key}`} tone="error">{message}</FormMessage>)}
        </label>)}
        {!personal && <label className="space-y-1 text-sm" htmlFor="piecework-source"><span>调价依据</span><Input id="piecework-source" name="sourceName" maxLength={500} defaultValue={draft.sourceName} /></label>}
        <label className="space-y-1 text-sm" htmlFor="piecework-note"><span>调整说明（发布时至少两字）</span><Input id="piecework-note" name="publishNote" maxLength={500} defaultValue={draft.publishNote} /></label>
        <label className="space-y-1 text-sm" htmlFor="piecework-mode"><span>生效方式</span><NativeSelect id="piecework-mode" value={scheduled ? 'scheduled' : 'immediate'} onChange={(e) => setScheduled(e.target.value === 'scheduled')}><option value="immediate">立即生效</option><option value="scheduled">指定时间</option></NativeSelect></label>
        {scheduled && <label className="space-y-1 text-sm" htmlFor="piecework-effective"><span>生效时间</span><Input id="piecework-effective" type="datetime-local" required value={effective} onChange={(e) => setEffective(e.target.value)} /></label>}
      </fieldset>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" name="intent" value="save" disabled={pending || (scheduled && !validTime)}>{pending ? '正在处理…' : '保存草稿'}</Button>
        <Button type="button" variant="outline" disabled={pending || dirty || !ready} onClick={() => setReview(true)}>核对并发布</Button>
      </div>
      {dirty && <FormMessage fieldId="piecework-save">请先保存修改再发布。</FormMessage>}
    </form>
    {review && <form aria-busy={pending} action={action} className="space-y-4 rounded-lg border bg-muted/20 p-4" aria-label="发布工价">
      <h3 className="font-medium">发布第 {draft.version} 版工价</h3>
      {personal && <p className="text-sm">工价模式：{!previous || previous.useUnifiedRates ? '统一工价' : '个人工价'} → {draft.useUnifiedRates ? '统一工价' : '个人工价'}</p>}
      <ul className="space-y-2 text-sm">
        {(draft.useUnifiedRates ? [] : fields).map((field) => {
          const old = rateFor(personal && (!previous || previous.useUnifiedRates) ? unifiedReference : previous, field); const next = rateFor(draft, field);
          const difference = old && next ? new Decimal(next).minus(old) : null;
          return <li key={field.key}>{field.label}：{old || '未配置'} → {next || '未配置'} {next && field.unitLabel}{difference && `（差额 ${difference.gte(0) ? '+' : ''}${formatUnitPrice(difference)}）`}</li>;
        })}
      </ul>
      <p className="text-sm">生效时间：{draft.effectiveFrom ? formatDateTimeShanghai(new Date(draft.effectiveFrom)) : '发布后立即生效'}。生效后的报工使用新工价，已有工资保持不变。{personal && draft.useUnifiedRates && !unifiedReference && '统一工价尚未发布，计件报工将暂停。'}{!personal && !rateFor(draft, PIECEWORK_RATE_FIELDS[2]) && '未配置入袋工价，入袋报工将暂停。'}{!draft.useUnifiedRates && fields.some((f) => f.key === 'box') && !rateFor(draft, PIECEWORK_RATE_FIELDS[3]) && '未配置装盒工价，装盒报工将暂停。'}</p>
      <input type="hidden" name="version" value={draft.version} /><input type="hidden" name="updatedAt" value={draft.updatedAt} />
      <div className="flex gap-2"><Button name="intent" value="publish" type="submit" disabled={pending}>{pending ? '正在发布…' : '发布工价'}</Button><Button type="button" variant="outline" disabled={pending} onClick={() => setReview(false)}>返回编辑</Button></div>
    </form>}
  </div>;
}
