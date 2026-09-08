'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight, Copy, FileDown, ImageOff, Pencil } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Disclosure, DisclosureSummary } from '@/components/ui/disclosure';
import { ActionNotice, StatusBadge, TableEmptyState } from '@/components/ui-business';
import { ORDER_CHANGE_REQUEST_STATUS_REGISTRY, ORDER_STATUS_REGISTRY } from '@/lib/ui/status-registry';
import { formatMoney } from '@/lib/dashboard/format';
import { cn } from '@/lib/utils';
import { OrderDetailStickyScope } from './OrderDetailStickyScope';
import type { AdminOrderDetailModel } from './admin-order-detail-model';
import styles from './AdminOrderDetailView.module.css';

export type DetailPrintRecord = {
  id: string;
  version: number;
  state: 'PENDING' | 'PRINTED' | 'SUPERSEDED';
  at: string;
};

type Props = {
  model: AdminOrderDetailModel;
  canEdit: boolean;
  decision: ReactNode;
  prints: DetailPrintRecord[];
  printHint?: string;
  supplementary: Array<{ id: string; title: string; content: ReactNode }>;
  packaging?: ReactNode;
};

function amount(value: string | null) {
  return value === null ? '待核定' : formatMoney(value);
}

function Progress({ label, done, total, unit = '个' }: {
  label: string; done: string; total: string; unit?: string;
}) {
  // Percent is display-only. Financial and production facts remain server-owned.
  const ratio = Number(total) > 0 ? Number(done) / Number(total) * 100 : 0;
  return <div className={styles.progress}>
    <div><span>{label}</span><strong>{done} / {total} {unit}</strong></div>
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100}
      aria-valuenow={Math.max(0, Math.min(100, ratio))} aria-valuetext={`${done} / ${total} ${unit}`}>
      <span style={{ width: `${Math.max(0, Math.min(100, ratio))}%` }} />
    </div>
  </div>;
}

export function AdminOrderDetailView({ model, canEdit, decision, prints, printHint, supplementary, packaging }: Props) {
  const [copyNotice, setCopyNotice] = useState<{ text: string; failed: boolean } | null>(null);
  const [preview, setPreview] = useState<number | null>(null);
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const imageTrigger = useRef<HTMLButtonElement | null>(null);
  const images = model.items.flatMap((item) => item.images.map((image) => ({ ...image, item })));
  const selectedImage = preview === null ? null : images[preview];
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const locate = useCallback((id: string) => {
    const element = document.getElementById(id);
    if (!element) return;
    for (let parent: HTMLElement | null = element; parent; parent = parent.parentElement) {
      if (parent instanceof HTMLDetailsElement) parent.open = true;
    }
    if (!element.hasAttribute('tabindex') && !element.matches('a,button,input,select,textarea')) element.tabIndex = -1;
    element.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
    element.focus({ preventScroll: true });
    if (timer.current) clearTimeout(timer.current);
    setHighlighted(id);
    timer.current = setTimeout(() => setHighlighted(null), 1400);
  }, []);

  useEffect(() => {
    const revealHash = () => {
      try { if (location.hash) locate(decodeURIComponent(location.hash.slice(1))); }
      catch { /* Malformed external hash does not affect the order view. */ }
    };
    const frame = requestAnimationFrame(revealHash);
    window.addEventListener('hashchange', revealHash);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('hashchange', revealHash); };
  }, [locate]);

  function closePreview() {
    setPreview(null);
    requestAnimationFrame(() => imageTrigger.current?.focus());
  }

  function cycle(direction: number) {
    setPreview((current) => current === null || !images.length ? null : (current + direction + images.length) % images.length);
  }

  const hasProgress = Number(model.progress.foilingProgress) > 0 || Number(model.progress.packingProgress) > 0 || model.works.length > 0;
  const versionChanged = prints.some((record) => record.version < model.version);

  return <div className={styles.surface} data-testid="admin-order-detail" onClickCapture={(event) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
    if (!(link instanceof HTMLAnchorElement) || link.target === '_blank' || !link.hash) return;
    const url = new URL(link.href);
    if (url.origin !== location.origin || url.pathname !== location.pathname || url.search !== location.search) return;
    let id: string;
    try { id = decodeURIComponent(url.hash.slice(1)); } catch { return; }
    if (!document.getElementById(id)) return;
    event.preventDefault();
    history.pushState(history.state, '', url.hash);
    locate(id);
  }}>
    <OrderDetailStickyScope header={<div className={styles.header}>
      <div className={styles.identity}>
        <h1 className="admin-wrap-anywhere text-xl font-semibold">{model.name?.trim() || '未命名工单'}</h1>
        <StatusBadge tone={ORDER_STATUS_REGISTRY[model.status].tone}>{ORDER_STATUS_REGISTRY[model.status].label}</StatusBadge>
        {model.isUrgent ? <StatusBadge tone="warning">急单</StatusBadge> : null}
        <p className={styles.meta}>{model.customer} · {model.sales} · {model.craft}</p>
        <Disclosure className="basis-full">
          <DisclosureSummary>工单信息</DisclosureSummary>
          <div className="flex flex-wrap items-center gap-3 pb-3">
            <Button type="button" variant="ghost" aria-label="复制工单号" className={styles.number}
              onClick={async () => {
                try { await navigator.clipboard.writeText(model.no); setCopyNotice({ text: '工单号已复制', failed: false }); }
                catch { setCopyNotice({ text: '复制失败，请手动复制工单号', failed: true }); }
              }}>{model.no}<Copy aria-hidden="true" className="size-3.5 shrink-0" /></Button>
            <span className={styles.version}>版本 v{model.version}</span>
          </div>
        </Disclosure>
      </div>
      <div className={styles.headerActions}>
        <Link href={`/api/orders/${model.id}/pdf`} className={buttonVariants({ variant: 'outline' })}><FileDown aria-hidden="true" />工单 PDF</Link>
        {canEdit ? <Link href={`/orders/${model.id}/edit`} className={buttonVariants({ variant: 'outline' })}><Pencil aria-hidden="true" />编辑工单</Link> : null}
      </div>
    </div>}>
      {copyNotice ? <ActionNotice tone={copyNotice.failed ? 'error' : 'success'} title={copyNotice.text} /> : null}
      <div className={styles.columns}>
        <div className={styles.main}>
          {model.vdiff ? <section className={styles.diff} aria-label="最新变更差异">
            <div className={styles.sectionHeading}><h2>变更已生效 · v{model.vdiff.from} → v{model.vdiff.to}</h2><span>批准于 {model.vdiff.at}</span></div>
            <div className={styles.diffItems}>{model.vdiff.items.map((entry) => <Button key={entry.id} type="button" variant="outline"
              onClick={() => locate(entry.targetItemId ? `order-detail-item-${entry.targetItemId}` : entry.targetSection === 'items' ? 'order-detail-items-title' : entry.targetSection === 'overview' ? 'order-detail-overview' : 'order-detail-fees')}>
              <span>{entry.label}<span><del>{entry.before}</del> → <strong>{entry.after}</strong></span></span>
            </Button>)}</div>
          </section> : null}

          <section aria-labelledby="order-detail-items-title">
            <div className={styles.sectionHeading}><h2 id="order-detail-items-title">款式明细</h2><span>{model.items.length} 款 · {model.qty.toLocaleString('zh-CN')} 个</span><span className={styles.hint}>点设计图查看大图</span></div>
            <div className={styles.itemList}>
              {model.items.length === 0 ? <TableEmptyState variant="compact" title="未记录款式" description="请在编辑页核对款式资料。" /> : model.items.map((item) => {
                const id = `order-detail-item-${item.id}`;
                return <article key={item.id} id={id} tabIndex={-1} className={cn(styles.item, highlighted === id && styles.highlight)}>
                  {item.images.length ? <Button type="button" variant="ghost" className={cn(styles.thumbnail, 'p-0')} aria-label={`查看第 ${item.sequence} 款设计图`}
                    onClick={(event) => { imageTrigger.current = event.currentTarget; setPreview(images.findIndex((image) => image.item.id === item.id)); }}>
                    {/* Private design URLs are signed on the server and kept out of image optimization caches. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={item.images[0].url} alt={`${item.name}设计图`} />
                    <span className={styles.figure}>{item.fig}</span><span className={styles.imageCount}>{item.images.length} 张</span>
                  </Button> : <div className={cn(styles.thumbnail, styles.noImage)}><ImageOff aria-hidden="true" /><span>未上传设计图</span><span className={styles.figure}>{item.fig}</span></div>}
                  <div className={styles.itemBody}>
                    <div className={styles.itemHeading}><h3>{item.name}</h3>{item.isNew ? <StatusBadge tone="warning">v{model.version} 新增</StatusBadge> : null}
                      <strong className={cn(styles.quantity, item.isNew && styles.newQuantity)}>{item.qty.toLocaleString('zh-CN')} 个<small>{item.pack}</small></strong></div>
                    <dl className={styles.specs}>{item.specs.map((spec) => <div key={spec.label}><dt>{spec.label}</dt><dd>{spec.value}</dd></div>)}</dl>
                    <div className={styles.fileStatus}><StatusBadge tone={item.hasCdr ? 'success' : 'warning'}>{item.hasCdr ? 'CDR 已上传' : '未上传 CDR'}</StatusBadge>
                      <Button type="button" variant="ghost" onClick={() => locate('detail-design-files')}>查看设计文件</Button></div>
                    {item.progress.map((progress) => <Progress key={progress.label} {...progress} />)}
                    {item.remark ? <p className={styles.remark}>{item.remark}</p> : null}
                    <dl className={styles.feeLines}>{item.fees.map((fee) => <div key={fee.id}><dt>{fee.label}</dt><dd>{amount(fee.amount)}</dd></div>)}</dl>
                  </div>
                </article>;
              })}
            </div>
            <section className={cn(styles.card, styles.orderFees)} aria-label="订单级费用">
              <dl className={styles.feeLines}>{model.orderFees.map((fee) => <div key={fee.id}><dt>{fee.label}<small>订单级</small></dt><dd>{amount(fee.amount)}</dd></div>)}</dl>
              <div className={styles.total}><span>{model.feeSource === 'LEGACY' ? '历史金额' : `当前${model.feeStages.find((stage) => stage.current)?.title ?? '金额'}`}</span><strong>{amount(model.total)}</strong></div>
            </section>
          </section>

          <section id="order-detail-fees" tabIndex={-1} className={cn(styles.card, highlighted === 'order-detail-fees' && styles.highlight)}>
            <div className={styles.sectionHeading}><h2>费用记录</h2><span>以各阶段保存金额为准</span></div>
            <div className={styles.feeStages}>{model.feeStages.map((stage) => <div key={stage.key} className={cn(styles.feeStage, stage.current && styles.currentFee)}>
              <p>{stage.title}{stage.current ? <span>当前</span> : null}</p><strong>{stage.total === null ? '—' : amount(stage.total)}</strong>
              {stage.total === null ? <small>{stage.key === 'confirmed' ? '费用核定后显示' : stage.key === 'settled' ? '结算后显示' : '尚未形成报价'}</small> : null}
            </div>)}</div>
          </section>

          <section className={styles.card} aria-label="变更历史">
            <div className={styles.sectionHeading}><h2>变更历史</h2><span>{model.changes.length} 次申请</span></div>
            {model.changes.length === 0 ? <TableEmptyState variant="compact" title="暂无变更" description="批准修改后，按实际变更更新工单版本。" /> : <ol className={styles.history}>{model.changes.map((change) => <li key={change.id}>
              <div className={styles.sectionHeading}><strong>{change.reason}</strong><StatusBadge tone={ORDER_CHANGE_REQUEST_STATUS_REGISTRY[change.status].tone}>{ORDER_CHANGE_REQUEST_STATUS_REGISTRY[change.status].label}</StatusBadge></div>
              <p>{change.requester} · {change.at}{change.reviewedAt ? ` · ${change.reviewer ?? '管理员'}审核于 ${change.reviewedAt}` : ''}</p>
              <div className={styles.changeRows}>{change.diffs.map((entry) => <div key={entry.id}><span>{entry.label}</span><del>{entry.before}</del><span>→</span><strong>{entry.after}</strong></div>)}</div>
            </li>)}</ol>}
          </section>

          <section className={styles.ledger} aria-label="报工流水">
            <div className={styles.sectionHeading}><h2>报工流水</h2><span>当前版本 · 最近 {model.works.length} 条</span></div>
            {model.works.length === 0 ? <TableEmptyState variant="compact" title="暂无报工记录" description="生产开始后显示，报工数量以生产记录为准。" /> : <ol>{model.works.map((work) => <li key={work.id} className={styles.workRow}>
              <time>{work.at}</time><span>{work.label}{work.cumulative !== null ? <small>累计 {work.cumulative} {work.unit}</small> : null}</span><b>{work.actor}</b><strong>{work.quantity === null ? '—' : `${work.quantity} ${work.unit}`}</strong>
            </li>)}</ol>}
          </section>

          <section className={styles.ledger} aria-label="动态">
            <div className={styles.sectionHeading}><h2>动态</h2><span>最近 {model.logs.length} 条</span></div>
            {model.logs.length === 0 ? <TableEmptyState variant="compact" title="暂无动态" /> : <ol>{model.logs.map((log) => <li key={log.id} className={styles.logRow}>
              <time>{log.at}</time><div><strong>{log.label}</strong>{log.remark ? <p>{log.remark}</p> : null}
              {log.changes.filter((change) => change.label !== '其他变更').map((change, index) => <p key={`${change.label}-${index}`}>{change.label}：{change.before} → {change.after}</p>)}</div><b>{log.actor}</b>
            </li>)}</ol>}
          </section>

          {packaging ? <Disclosure className={styles.extra}><DisclosureSummary>分货与包装明细</DisclosureSummary><div>{packaging}</div></Disclosure> : null}
          {supplementary.length ? <section className={styles.supplementary} aria-label="管理与业务记录"><h2>管理与业务记录</h2>{supplementary.map((section) => <Disclosure key={section.id} id={section.id} tabIndex={-1} className={cn(styles.extra, highlighted === section.id && styles.highlight)}>
            <DisclosureSummary>{section.title}</DisclosureSummary><div>{section.content}</div>
          </Disclosure>)}</section> : null}
        </div>

        <aside className={styles.aside} aria-label="工单概览与操作">
          <section id="order-detail-actions" tabIndex={-1} className={cn(styles.card, styles.decision)} aria-label="当前待办"><div className={styles.eyebrow}>当前待办</div>
            {decision ?? <p>{ORDER_STATUS_REGISTRY[model.status].label} · 暂无待办</p>}
          </section>
          <section id="order-detail-overview" tabIndex={-1} className={cn(styles.card, highlighted === 'order-detail-overview' && styles.highlight)}><h2 className={styles.eyebrow}>概览</h2><p className={styles.orderName}>{model.name}</p>
            <div className={styles.stats}><div><strong>{model.due ?? '未设置'}</strong><span>{model.due ? model.dueLeft : '交货日期'}</span></div><div><strong>{model.items.length} 款 · {model.qty.toLocaleString('zh-CN')}</strong><span>工单总量（个）</span></div></div>
            {hasProgress ? <div className={styles.progressList}><Progress label="烫金" done={model.progress.foilingProgress} total={model.progress.orderTotal} /><Progress label="打包" done={model.progress.packingProgress} total={model.progress.orderTotal} /></div> : <p className={styles.emptyHint}>确认并下发生产后，报工进度在此显示</p>}
          </section>
          <section className={styles.card}><h2 className={styles.eyebrow}>版本与打印</h2>
            {prints.length ? <ol className={styles.prints}>{prints.map((print) => <li key={print.id}><span>工单 v{print.version}<small>{print.at}</small></span><StatusBadge tone={print.version !== model.version || print.state === 'SUPERSEDED' ? 'danger' : print.state === 'PRINTED' ? 'success' : 'warning'}>
              {print.version !== model.version || print.state === 'SUPERSEDED' ? '已作废' : print.state === 'PRINTED' ? '已打印' : '待打印'}</StatusBadge></li>)}</ol> : <p className={styles.emptyHint}>未生成打印任务 · 下发生产后生成</p>}
            {versionChanged ? <p className={styles.emptyHint}>旧版纸质工单已失效，请使用 v{model.version}。</p> : null}
            {printHint ? <p className={styles.emptyHint}>{printHint}</p> : null}
            <Link href={`/print/orders/${model.id}?autoprint=1`} target="_blank" rel="noopener noreferrer" className={cn(buttonVariants({ variant: 'outline' }), styles.printLink)}>打开打印版</Link>
          </section>
          <section className={styles.card}><h2 className={styles.eyebrow}>收货</h2>{model.shipments.length ? <ol className={styles.shipments}>{model.shipments.map((shipment) => <li key={shipment.id}>
            <p>{model.shipments.length > 1 ? `第 ${shipment.sequence} 票 · ` : ''}{shipment.name} {shipment.phone}</p><strong>{shipment.address || '未填写收货地址'}</strong>
            {shipment.trackingNo ? <p>{shipment.carrier} · {shipment.trackingNo}</p> : null}<small>{shipment.items.join(' · ')}</small>
          </li>)}</ol> : <p className={styles.emptyHint}>未填写收货地址{canEdit ? <> · <Link href={`/orders/${model.id}/edit`}>去编辑页补充</Link></> : null}</p>}</section>
        </aside>
      </div>
    </OrderDetailStickyScope>

    <Dialog open={preview !== null} onOpenChange={(open) => { if (!open) closePreview(); }}>
      <DialogContent className={styles.lightbox} showCloseButton={false} onKeyDown={(event) => {
        if (event.key === 'ArrowLeft') { event.preventDefault(); cycle(-1); }
        if (event.key === 'ArrowRight') { event.preventDefault(); cycle(1); }
      }}>
        <DialogTitle className="sr-only">设计图预览</DialogTitle><DialogDescription className="sr-only">左右方向键切换设计图，Esc 关闭预览。</DialogDescription>
        {selectedImage ? <><div className={styles.previewImage}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={selectedImage.url} alt={selectedImage.name} />
          <Button type="button" variant="outline" aria-label="上一张" disabled={images.length < 2} onClick={() => cycle(-1)}><ChevronLeft aria-hidden="true" /></Button>
          <Button type="button" variant="outline" aria-label="下一张" disabled={images.length < 2} onClick={() => cycle(1)}><ChevronRight aria-hidden="true" /></Button>
          <span>{(preview ?? 0) + 1} / {images.length}</span>
        </div><div className={styles.previewInfo}><h3>图 {selectedImage.item.fig} · {selectedImage.item.name}</h3><dl className={styles.specs}>{selectedImage.item.specs.map((spec) => <div key={spec.label}><dt>{spec.label}</dt><dd>{spec.value}</dd></div>)}</dl>
          <StatusBadge tone={selectedImage.item.hasCdr ? 'success' : 'warning'}>{selectedImage.item.hasCdr ? 'CDR 已上传' : '未上传 CDR'}</StatusBadge>
          <Button type="button" variant="outline" aria-label="关闭预览" onClick={closePreview}>关闭预览 · Esc</Button>
        </div></> : null}
      </DialogContent>
    </Dialog>
  </div>;
}
