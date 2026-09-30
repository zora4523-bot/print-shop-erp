'use client';

import { OrderPurposeBadge } from './OrderPurposeBadge';
import { OrderRemark } from './OrderRemark';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { ChevronDown, ChevronLeft, ChevronRight, Copy, FileDown, ImageOff, Pencil } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Disclosure, DisclosureSummary } from '@/components/ui/disclosure';
import { ActionNotice, PageHeader, StatusBadge, TableEmptyState, useCopyToClipboard } from '@/components/ui-business';
import { ORDER_CHANGE_REQUEST_STATUS_REGISTRY, ORDER_STATUS_REGISTRY } from '@/lib/ui/status-registry';
import { formatMoney } from '@/lib/dashboard/format';
import { OrderAmount } from './OrderAmount';
import { cn } from '@/lib/utils';
import { OrderDetailStickyScope } from './OrderDetailStickyScope';
import type { AdminOrderDetailModel } from './admin-order-detail-model';
import { revealOrderDetailTarget } from './order-detail-navigation';
import styles from './AdminOrderDetailView.module.css';

export type DetailPrintRecord = {
  id: string;
  version: number;
  state: 'PENDING' | 'PRINTED' | 'SUPERSEDED';
  at: string;
};

type Props = {
  model: AdminOrderDetailModel;
  simpleProduction?: boolean;
  productionOwners?: string[];
  canEdit: boolean;
  decision: ReactNode;
  prints: DetailPrintRecord[];
  printHint?: string;
  supplementary: Array<{ id: string; title: string; content: ReactNode }>;
  packaging?: ReactNode;
  itemDetails?: Array<{ itemId: string; content: ReactNode }>;
  printActions?: ReactNode;
};

function amount(value: string | null, status: AdminOrderDetailModel['status'], estimated = false, pricingStatus?: AdminOrderDetailModel['pricingStatus'], incomplete = false) {
  return <OrderAmount status={status} amount={value} estimated={estimated} pricingStatus={pricingStatus} incomplete={incomplete} />;
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

export function AdminOrderDetailView({ simpleProduction, productionOwners, model, canEdit, decision, prints, printHint, supplementary, packaging, itemDetails, printActions }: Props) {
  const { feedback: copyNotice, copy } = useCopyToClipboard();
  const otherActions = supplementary.find(section => section.id === 'detail-other-actions');
  const [preview, setPreview] = useState<number | null>(null);
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const [navigationNotice, setNavigationNotice] = useState<string | null>(null);
  const navigationRequest = useRef<AbortController | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const imageTrigger = useRef<HTMLButtonElement | null>(null);
  const images = model.items.flatMap((item) => item.images.map((image) => ({ ...image, item })));
  const selectedImage = preview === null ? null : images[preview];
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); navigationRequest.current?.abort(); }, []);

  const locate = useCallback(async (id: string) => {
    navigationRequest.current?.abort();
    const controller = new AbortController();
    navigationRequest.current = controller;
    setNavigationNotice(null);
    const element = await revealOrderDetailTarget(model.id, id, controller.signal);
    if (controller.signal.aborted) return;
    if (!element) {
      setNavigationNotice('该入口当前不可用，请核对工单状态或刷新后重试。');
      return;
    }
    for (let parent: HTMLElement | null = element; parent; parent = parent.parentElement) {
      if (parent instanceof HTMLDetailsElement) parent.open = true;
    }
    if (!element.hasAttribute('tabindex') && !element.matches('a,button,input,select,textarea')) element.tabIndex = -1;
    element.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
    element.focus({ preventScroll: true });
    if (timer.current) clearTimeout(timer.current);
    setHighlighted(id);
    timer.current = setTimeout(() => setHighlighted(null), 1400);
  }, [model.id]);

  useEffect(() => {
    const revealHash = () => {
      try { if (location.hash) locate(decodeURIComponent(location.hash.slice(1))); }
      catch { /* Malformed external hash does not affect the order view. */ }
    };
    const frame = requestAnimationFrame(revealHash);
    window.addEventListener('hashchange', revealHash);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('hashchange', revealHash); navigationRequest.current?.abort(); };
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

  const placedSections = new Set(['detail-design-files', 'detail-pricing-tools', 'detail-delivery-records', 'detail-production-records', 'detail-business-records', 'detail-audit-records', 'detail-other-actions', 'detail-costs', 'detail-after-sales']);
  function renderSections(ids: string[]) {
    return supplementary.filter((section) => ids.includes(section.id)).map((section) => (
      <Disclosure open key={section.id} id={section.id} tabIndex={-1} className={cn(styles.extra, highlighted === section.id && styles.highlight)}>
        <DisclosureSummary className={styles.disclosureSummary}><h2>{section.title}</h2><ChevronDown aria-hidden="true" className={styles.disclosureChevron} /><span className={styles.expandLabel}>展开</span><span className={styles.collapseLabel}>收起</span></DisclosureSummary><div>{section.content}</div>
      </Disclosure>
    ));
  }
  const navigation = [
    { id: 'order-detail-items-title', title: '款式资料' },
    { id: 'order-detail-fees', title: '费用' },
    ...(supplementary.some((section) => section.id === 'detail-delivery-records') ? [{ id: 'detail-delivery-records', title: '配送发货' }] : [{ id: 'order-delivery-summary', title: '配送发货' }]),
    { id: 'order-production-records', title: '生产记录' },
    ...(supplementary.some(section => section.id === 'detail-after-sales') ? [{ id: 'detail-after-sales', title: '售后' }] : []),
    { id: 'order-history-records', title: '操作记录' },
  ];

  return <div className={styles.surface} data-testid="admin-order-detail" onClickCapture={(event) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
    if (!(link instanceof HTMLAnchorElement) || link.target === '_blank' || !link.hash) return;
    const url = new URL(link.href);
    if (url.origin !== location.origin || url.pathname !== location.pathname || url.search !== location.search) return;
    let id: string;
    try { id = decodeURIComponent(url.hash.slice(1)); } catch { return; }
    event.preventDefault();
    history.pushState(history.state, '', url.hash);
    locate(id);
  }}>
    <OrderDetailStickyScope header={<div className={styles.header}>
      <div className={styles.identity}>
        <PageHeader className="basis-full" back={{ href: '/orders', label: '返回工单列表' }}
          eyebrow={<OrderPurposeBadge purpose={model.purpose} />}
          title={model.name?.trim() || '未命名工单'}
          status={<><StatusBadge tone={ORDER_STATUS_REGISTRY[model.status].tone}>{ORDER_STATUS_REGISTRY[model.status].label}</StatusBadge>
            {model.isUrgent ? <StatusBadge tone="warning">急单</StatusBadge> : null}</>} />
        <p id="order-detail-overview" tabIndex={-1} className={cn(styles.meta, highlighted === 'order-detail-overview' && styles.highlight)}><span>业务员：{model.sales ?? '未填'}</span><span>交期：{model.due ?? '未设置'}{model.dueLeft ? ` · ${model.dueLeft}` : ''}</span><span>{model.items.length} 款 · {model.qty.toLocaleString('zh-CN')} 个</span></p>
        {!!productionOwners?.length && <p className="basis-full text-sm">生产师傅：{productionOwners.join("、")}</p>}
        <a href="#detail-production-records" className="inline-flex min-h-11 items-center text-sm underline">生产安排与提成</a>
        <Disclosure className="basis-full">
          <DisclosureSummary className={styles.disclosureSummary}><span>工单信息</span><ChevronDown aria-hidden="true" className={styles.disclosureChevron} /><span className={styles.expandLabel}>展开</span><span className={styles.collapseLabel}>收起</span></DisclosureSummary>
          <div className="flex flex-wrap items-center gap-3 pb-3">
            <Button type="button" variant="ghost" aria-label="复制工单号" className={styles.number}
              onClick={() => copy(model.no, '工单号')}>{model.no}<Copy aria-hidden="true" className="size-3.5 shrink-0" /></Button>
            <span className={styles.version}>第 {model.version} 版</span>
          </div>
        </Disclosure>
      </div>
      {!otherActions ? <div className={styles.headerActions}>
        <a href={`/api/orders/${model.id}/pdf`} className={buttonVariants({ variant: 'outline' })}><FileDown aria-hidden="true" />工单 PDF</a>
        {canEdit ? <Link href={`/orders/${model.id}/edit`} className={buttonVariants({ variant: 'outline' })}><Pencil aria-hidden="true" />编辑工单</Link> : null}
      </div> : null}
    </div>}>
      {copyNotice ? <ActionNotice tone={copyNotice.tone} title={copyNotice.message} /> : null}
      {navigationNotice ? <ActionNotice tone="warning" title={navigationNotice} /> : null}
      <nav className={styles.navigation} aria-label="工单区块导航">{navigation.map((entry) => <a key={entry.id} href={`#${entry.id}`}>{entry.title}</a>)}</nav>
      <div className={styles.columns}>
        <aside className={styles.aside} aria-label="工单概览与操作">
          <section id="order-detail-actions" tabIndex={-1} data-emphasis="inverse" className={cn(styles.card, styles.decision)} aria-label="当前待办"><h2 className={styles.eyebrow}>当前待办</h2>
            {decision ?? <p>{ORDER_STATUS_REGISTRY[model.status].label} · 暂无待办</p>}
            {otherActions ? <div id="detail-other-actions" tabIndex={-1} className={styles.otherActions}><h3>维护与其他操作</h3>{otherActions.content}</div> : null}
          </section>
          {hasProgress && !simpleProduction ? <section className={styles.asideSection} aria-label="生产进度"><h2 className={styles.eyebrow}>生产进度</h2><Progress label="烫金" done={model.progress.foilingProgress} total={model.progress.orderTotal} /><Progress label="打包" done={model.progress.packingProgress} total={model.progress.orderTotal} /></section> : null}
          <section className={styles.asideSection}><h2 className={styles.eyebrow}>版本与打印</h2>{printActions ? <div className="mb-3 flex flex-wrap gap-2">{printActions}</div> : null}
            {prints.length ? <ol className={styles.prints}>{prints.map((print) => <li key={print.id}><span>工单 v{print.version}<small>{print.at}</small></span><StatusBadge tone={print.version !== model.version || print.state === 'SUPERSEDED' ? 'danger' : print.state === 'PRINTED' ? 'success' : 'warning'}>
              {print.version !== model.version || print.state === 'SUPERSEDED' ? '已作废' : print.state === 'PRINTED' ? '已打印' : '待打印'}</StatusBadge></li>)}</ol> : <p className={styles.emptyHint}>尚未创建打印任务</p>}
            {versionChanged ? <p className={styles.emptyHint}>旧版纸质工单已失效，请使用 v{model.version}。</p> : null}
            {printHint ? <p className={styles.emptyHint}>{printHint}</p> : null}
            {!otherActions ? <a href={`/print/orders/${model.id}?autoprint=1`} target="_blank" rel="noopener noreferrer" className={cn(buttonVariants({ variant: 'outline' }), styles.printLink)}>打开打印版</a> : null}
            {!otherActions ? <Link href={`/print/orders/${model.id}`} prefetch={false} target="_blank" rel="noopener noreferrer" className={cn(buttonVariants({ variant: 'outline' }), styles.printLink)}>网页预览</Link> : null}
          </section>

        </aside>
        <div className={styles.main}>
          <OrderRemark remark={model.remark} />
          {model.vdiff ? <section className={styles.diff} aria-label="最新变更差异">
            <div className={styles.sectionHeading}><h2>变更已生效 · v{model.vdiff.from} → v{model.vdiff.to}</h2><span>批准于 {model.vdiff.at}</span></div>
            <div className={styles.diffItems}>{model.vdiff.items.map((entry) => <Button key={entry.id} type="button" variant="ghost"
              onClick={() => locate(entry.targetItemId ? `order-detail-item-${entry.targetItemId}` : entry.targetSection === 'items' ? 'order-detail-items-title' : entry.targetSection === 'overview' ? 'order-detail-overview' : 'order-detail-fees')}>
              <span>{entry.label}<span><del>{entry.before}</del> → <strong>{entry.after}</strong></span></span>
            </Button>)}</div>
          </section> : null}

          <section id={itemDetails ? 'detail-design-files' : undefined} aria-labelledby="order-detail-items-title">
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
                      <Button type="button" variant="ghost" onClick={() => locate(document.getElementById(`detail-design-item-${item.id}`) ? `detail-design-item-${item.id}` : 'detail-design-files')}>查看设计文件</Button></div>
                    {!simpleProduction && item.progress.map((progress) => <Progress key={progress.label} {...progress} />)}
                    {item.remark ? <p className={styles.remark}>{item.remark}</p> : null}
                    <dl className={styles.feeLines}>{item.fees.map((fee) => <div key={fee.id}><dt>{fee.label}</dt><dd>{amount(fee.amount, model.status, fee.estimated)}</dd></div>)}</dl>
                  </div>
                  {itemDetails?.find(detail => detail.itemId === item.id)?.content ? <div className={styles.itemDetails}>{itemDetails.find(detail => detail.itemId === item.id)?.content}</div> : null}
                </article>;
              })}
            </div>
          </section>

          {!itemDetails ? renderSections(['detail-design-files']) : null}
          <section id="order-detail-fees" tabIndex={-1} className={cn(styles.card, highlighted === 'order-detail-fees' && styles.highlight)} aria-label="工单费用">
            <div className={styles.sectionHeading}><h2>工单费用</h2></div>
            <section className={styles.orderFees} aria-label="订单级费用">
              <dl className={styles.feeLines}>{model.itemProcessingAmount !== undefined ? <div><dt>款式加工费合计</dt><dd>{amount(model.itemProcessingAmount, model.status, model.processingEstimated)}</dd></div> : null}{model.orderFees.map((fee) => <div key={fee.id}><dt>{fee.label}</dt><dd>{amount(fee.amount, model.status, fee.estimated)}</dd></div>)}</dl>
              {model.hasItemPlateFees ? <p className={styles.emptyHint}>制版费见各款式，未计入款式加工费合计。</p> : null}
              <div className={styles.total}><span>{model.feeSource === 'LEGACY' ? '历史金额' : `当前${model.feeStages.find((stage) => stage.current)?.title ?? '金额'}`}{model.isSfCollect ? <small className="block text-xs font-normal">不含快递费，含耗材费</small> : null}</span><strong data-slot="current-order-amount">{amount(model.total, model.status, model.totalEstimated ?? model.feeSource === 'QUOTED', model.pricingStatus, model.feeSource === 'INCOMPLETE')}</strong></div>
            </section>
            <h3 className={styles.feeHistoryHeading}>费用记录</h3>
            <div className={styles.feeStages}>{model.feeStages.map((stage) => <div key={stage.key} className={cn(styles.feeStage, stage.current && styles.currentFee)}>
              <p>{stage.title}{stage.current ? <span>当前</span> : null}</p><strong>{stage.current ? amount(model.total, model.status, model.totalEstimated, model.pricingStatus, model.feeSource === 'INCOMPLETE') : stage.total === null ? '—' : formatMoney(stage.total)}</strong>
              {!stage.current && stage.total === null ? <small>{stage.key === 'confirmed' ? '费用核定后显示' : stage.key === 'settled' ? '结算后显示' : '尚未形成报价'}</small> : null}
            </div>)}</div>
          </section>

          {renderSections(['detail-pricing-tools', 'detail-costs'])}
          {packaging ? <Disclosure id="detail-packaging" className={styles.extra}><DisclosureSummary className={styles.disclosureSummary}>分货与包装明细<ChevronDown aria-hidden="true" className={styles.disclosureChevron} /><span className={styles.expandLabel}>展开</span><span className={styles.collapseLabel}>收起</span></DisclosureSummary><div>{packaging}</div></Disclosure> : null}
          {renderSections(['detail-delivery-records'])}
          {!supplementary.some((section) => section.id === 'detail-delivery-records') ? <section id="order-delivery-summary" tabIndex={-1} className={styles.card}><h2 className={styles.eyebrow}>收货</h2>{model.shipments.length ? <ol className={styles.shipments}>{model.shipments.map((shipment) => <li key={shipment.id}>
            <p>{model.shipments.length > 1 ? `第 ${shipment.sequence} 票 · ` : ''}{shipment.name} {shipment.phone}</p><strong>{shipment.address || '未填写收货地址'}</strong>
            {shipment.trackingNo ? <p>{shipment.carrier} · {shipment.trackingNo}</p> : null}<small>{shipment.items.join(' · ')}</small>
          </li>)}</ol> : <p className={styles.emptyHint}>未填写收货地址{canEdit ? <> · <Link href={`/orders/${model.id}/edit`}>去编辑页补充</Link></> : null}</p>}</section> : null}
          <div id="order-production-records" tabIndex={-1} className={styles.sectionHeading}><h2>生产记录</h2></div>
          {renderSections(['detail-production-records', 'detail-business-records'])}
          {(!simpleProduction || model.works.length > 0) && <section className={styles.ledger} aria-label="报工流水">
            <div className={styles.sectionHeading}><h2>报工流水</h2><span>当前版本 · 最近 {model.works.length} 条</span></div>
            {model.works.length === 0 ? <p className={styles.emptyHint}>暂无报工记录</p> : <ol>{model.works.map((work) => <li key={work.id} className={styles.workRow}>
              <time>{work.at}</time><span>{work.label}{work.cumulative !== null ? <small>累计 {work.cumulative} {work.unit}</small> : null}</span><b>{work.actor}</b><strong>{work.quantity === null ? '—' : `${work.quantity} ${work.unit}`}</strong>
            </li>)}</ol>}
          </section>}

          {renderSections(['detail-after-sales'])}
          <div id="order-history-records" tabIndex={-1} className={styles.historyGroup}>
          {!supplementary.some(section => section.id === 'detail-audit-records') ? <>
          <section className={styles.ledger} aria-label="变更历史">
            <div className={styles.sectionHeading}><h2>变更历史</h2><span>{model.changes.length} 次申请</span></div>
            {model.changes.length === 0 ? <p className={styles.emptyHint}>暂无变更</p> : <ol className={styles.history}>{model.changes.map((change) => <li key={change.id}>
              <div className={styles.sectionHeading}><strong>{change.reason}</strong><StatusBadge tone={ORDER_CHANGE_REQUEST_STATUS_REGISTRY[change.status].tone}>{ORDER_CHANGE_REQUEST_STATUS_REGISTRY[change.status].label}</StatusBadge></div>
              <p>{change.requester} · {change.at}{change.reviewedAt ? ` · ${change.reviewer ?? '管理员'}审核于 ${change.reviewedAt}` : ''}</p>
              <div className={styles.changeRows}>{change.diffs.map((entry) => <div key={entry.id}><span>{entry.label}</span><del>{entry.before}</del><span>→</span><strong>{entry.after}</strong></div>)}</div>
            </li>)}</ol>}
          </section>

          <section className={styles.ledger} aria-label="动态">
            <div className={styles.sectionHeading}><h2>动态</h2><span>最近 {model.logs.length} 条</span></div>
            {model.logs.length === 0 ? <p className={styles.emptyHint}>暂无动态</p> : <ol>{model.logs.map((log) => <li key={log.id} className={styles.logRow}>
              <time>{log.at}</time><div><strong>{log.label}</strong>{log.remark ? <p>{log.remark}</p> : null}
              {log.changes.filter((change) => change.label !== '其他变更').map((change, index) => <p key={`${change.label}-${index}`}>{change.label}：{change.before} → {change.after}</p>)}</div><b>{log.actor}</b>
            </li>)}</ol>}
          </section>

          </> : null}
          {renderSections(['detail-audit-records'])}
          </div>
          {renderSections(supplementary.filter((section) => !placedSections.has(section.id)).map((section) => section.id))}

        </div>


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
